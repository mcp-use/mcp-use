import React from "react";

export const Contributors = (props) => {
  let users = [];

  if (props.usernames) {
    users = Array.isArray(props.usernames)
      ? props.usernames
      : String(props.usernames).split(",").map(u => u.trim());
  } else if (props.users) {
    users = String(props.users).split(",").map(u => u.trim());
  }

  if (users.length === 0) return null;

  return (
    <div>
      <span className="text-base font-medium text-zinc-600 dark:text-zinc-300">Contributors</span>
      <div className="flex items-center" style={{ marginTop: '8px' }}>
        {users.map((username, index) => (
          <a
            key={username}
            href={`https://github.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`@${username}`}
            className="relative rounded-full transition-all duration-200 hover:z-50 hover:scale-110 block"
            style={{
              marginLeft: index === 0 ? 0 : '-8px',
              zIndex: users.length - index,
              lineHeight: 0,
            }}
          >
            <img
              noZoom
              src={`https://github.com/${username}.png`}
              alt={`@${username}`}
              width="32"
              height="32"
              style={{ display: 'block', margin: 0 }}
              className="rounded-full ring-2 ring-zinc-100 dark:ring-zinc-900"
            />
          </a>
        ))}
      </div>
    </div>
  );
};
