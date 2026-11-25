/**
 * Lua scripts shared by `redisStorage` and `upstashStorage` (Redis 6.2 or
 * later). Every key a script touches arrives in `KEYS[]`; nothing builds a
 * key inside a script, which Redis ACL key patterns and Redis Cluster need.
 *
 * KV values written through `write` are stored as a plain string
 * `"\0" + version + "|" + value`, so `GET`-based OAuth reads of other keys
 * are untouched. The log (pre-build check F3: Stream form) is a Stream with
 * explicit ids `<seq>-0` plus a head hash `{epoch, seq}`.
 *
 * @internal
 * @packageDocumentation
 */

/** Lua helpers prepended to the scripts that mint KV versions. */
const VERSION_HELPERS = `
local function parse(raw)
  if not raw then return nil, nil end
  if string.byte(raw, 1) == 0 then
    local bar = string.find(raw, "|", 2, true)
    if bar then return string.sub(raw, bar + 1), string.sub(raw, 2, bar - 1) end
  end
  return raw, "p"
end
local function nextVersion(old)
  local t = redis.call("TIME")
  local v = tonumber(t[1]) * 1000000 + tonumber(t[2])
  local o = tonumber(old)
  if o and v <= o then v = o + 1 end
  return string.format("%.0f", v)
end
`;

/**
 * Read: `KEYS[1]` key. Returns `false` or `{value, version}`.
 */
export const READ = `${VERSION_HELPERS}
local raw = redis.call("GET", KEYS[1])
if not raw then return false end
local value, version = parse(raw)
return {value, version}
`;

/**
 * Write: `KEYS[1]` key; `ARGV` = value, mode (`any` | `absent` | `version`),
 * expected version, ttlMs (`""` for none). Returns the new version or
 * `false`.
 */
export const WRITE = `${VERSION_HELPERS}
local raw = redis.call("GET", KEYS[1])
local mode = ARGV[2]
if mode == "absent" and raw then return false end
local _, current = parse(raw)
if mode == "version" and (not raw or current ~= ARGV[3]) then return false end
local version = nextVersion(current)
local stored = "\\0" .. version .. "|" .. ARGV[1]
if ARGV[4] ~= "" then
  redis.call("SET", KEYS[1], stored, "PX", ARGV[4])
else
  redis.call("SET", KEYS[1], stored)
end
return version
`;

/**
 * Remove: `KEYS[1]` key; `ARGV[1]` expected version or `""`. Returns 1 when
 * removed.
 */
export const REMOVE = `${VERSION_HELPERS}
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
if ARGV[1] ~= "" then
  local _, current = parse(raw)
  if current ~= ARGV[1] then return 0 end
end
redis.call("DEL", KEYS[1])
return 1
`;

/**
 * Incr: `KEYS[1]` counter; `ARGV` = by, ttlMs. Sets the expiry on the first
 * increment only.
 */
export const INCR = `
local value = redis.call("INCRBY", KEYS[1], ARGV[1])
if redis.call("PTTL", KEYS[1]) == -1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return value
`;

/**
 * Index range: `KEYS[1]` sorted set; `ARGV` = min (already raised to the
 * cursor score), max (Redis score bounds),
 * limit, cursor score (`""` for none), cursor member. Returns a flat
 * `member, score` list of up to `limit + 1` entries after the cursor, in
 * `(score, member)` order.
 */
export const INDEX_RANGE = `
local min = ARGV[1]
local limit = tonumber(ARGV[3])
local hasCursor = ARGV[4] ~= ""
local cscore = tonumber(ARGV[4])
local cmember = ARGV[5]
local out = {}
local offset = 0
local chunk = limit + 64
while #out < (limit + 1) * 2 do
  local page = redis.call("ZRANGE", KEYS[1], min, ARGV[2], "BYSCORE", "LIMIT", offset, chunk, "WITHSCORES")
  if #page == 0 then break end
  for i = 1, #page, 2 do
    local member, score = page[i], tonumber(page[i + 1])
    if (not hasCursor) or score > cscore or (score == cscore and member > cmember) then
      table.insert(out, member)
      table.insert(out, page[i + 1])
      if #out >= (limit + 1) * 2 then break end
    end
  end
  offset = offset + chunk
end
return out
`;

/**
 * Log append: `KEYS` = stream, head, dedupe key (or a placeholder),
 * mark index (or a placeholder); `ARGV` = value, maxEvents, dedupe ttlMs
 * (`""` when no dedupe), mark member (`""` when no mark), mark score,
 * notify channel (`""` for none), new epoch. Returns `{1, seq|false}` for a
 * duplicate or `{0, seq, epoch}`.
 */
export const LOG_APPEND = `
local hasDedupe = ARGV[3] ~= ""
local hasMark = ARGV[4] ~= ""
if hasDedupe then
  local existing = redis.call("GET", KEYS[3])
  if existing then return {1, existing} end
end
local head = redis.call("HMGET", KEYS[2], "epoch", "seq")
local epoch = head[1]
local seq = tonumber(head[2])
if not epoch then
  redis.call("DEL", KEYS[1])
  epoch = ARGV[7]
  seq = 0
end
seq = seq + 1
redis.call("HSET", KEYS[2], "epoch", epoch, "seq", seq)
redis.call("XADD", KEYS[1], seq .. "-0", "v", ARGV[1])
redis.call("XTRIM", KEYS[1], "MAXLEN", ARGV[2])
if hasDedupe then
  redis.call("SET", KEYS[3], seq, "PX", ARGV[3])
end
if hasMark then
  redis.call("ZADD", KEYS[4], "NX", ARGV[5], ARGV[4])
  if ARGV[6] ~= "" then
    redis.call("PUBLISH", ARGV[6], ARGV[4] .. ":" .. seq)
  end
end
return {0, seq, epoch}
`;

/**
 * Log range: `KEYS` = stream, head; `ARGV` = after seq (`""` for the
 * start), limit. Returns `{epoch|false, head, first, id1, value1, ...}`.
 */
export const LOG_RANGE = `
local head = redis.call("HMGET", KEYS[2], "epoch", "seq")
local seq = tonumber(head[2]) or 0
local out = {head[1] or false, seq}
local oldest = redis.call("XRANGE", KEYS[1], "-", "+", "COUNT", 1)
if #oldest > 0 then
  table.insert(out, oldest[1][1])
else
  table.insert(out, (seq + 1) .. "-0")
end
local limit = tonumber(ARGV[2])
if limit > 0 then
  local start = "-"
  if ARGV[1] ~= "" then start = "(" .. ARGV[1] .. "-0" end
  local entries = redis.call("XRANGE", KEYS[1], start, "+", "COUNT", limit)
  for _, entry in ipairs(entries) do
    table.insert(out, entry[1])
    table.insert(out, entry[2][2])
  end
end
return out
`;
