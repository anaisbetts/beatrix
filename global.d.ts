declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.jpeg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

// For Bun-specific imports
declare namespace Bun {
  interface FileImportAttributes {
    type: 'file'
  }
}

// Allow the "with { type: 'file' }" syntax
declare module '*' {
  const value: string
  export default value
}
