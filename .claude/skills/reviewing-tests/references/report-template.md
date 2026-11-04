# Report template

Use this in a PR description or review comment. One section per test, then a
summary table.

````markdown
## Test review: <file>

### <test name>

**Claims:** <the behaviour in one sentence>

**Break 1:** <what the edit does>

```diff
<git diff of the break edit>
```

Result: failed ✅

```
<the assertion failure lines>
```

**Break 2:** <only if the test makes another claim>

**Restructure:** <what the edit does>

```diff
<git diff of the restructure edit>
```

Result: passed ✅

**Verdict:** keep | rewrite (<what to assert instead>) | delete (<why>)

### Summary

| Test   | Breaks caught | Restructure | Verdict |
| ------ | ------------- | ----------- | ------- |
| <name> | 2/2           | passed      | keep    |
````

If a break survived, mark it ❌, quote the passing output, and explain which
assertion should have caught it. If the restructure failed, quote the failure
and name the implementation detail the test depends on.
