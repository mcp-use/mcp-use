import React from 'react'

export const CodeSandbox = ({
  title, id
}) => {
  return (
    <a href={`https://codesandbox.io/p/devbox/${id}?embed=1`}>
        <img noZoom src={`https://codesandbox.io/static/img/play-codesandbox.svg`} alt={title} />
    </a>
  )
}
