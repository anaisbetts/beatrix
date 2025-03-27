import getFileInfo, { type FileInfo } from './utils/get-file-info'
import path from 'path'

/**
 * Options for serveStatic().
 */
interface ServeStaticBaseOptions {
  /**
   * By default this module will send "index.html" files in response to a request on a directory.
   * To disable this, set it to `null`. To supply a new index, pass a string.
   *
   * @default "index.html"
   */
  index?: string | null

  /**
   * Redirect to trailing "/" when the pathname is a dir.
   *
   * @default true
   */
  dirTrailingSlash?: boolean

  /**
   * Collapse all slashes in the pathname (`//blog///test` => `/blog/test`).
   *
   * @default true
   */
  collapseSlashes?: boolean

  /**
   * Remove the first occurence of the specified string from the pathname.
   * Is not defined by default (no stripping).
   */
  stripFromPathname?: string

  /**
   * Headers to add to the response. The "Content-Type" header cannot be overwritten. If you want to
   * change the charset, use the `charset` option. If `collapseSlashes` or `dirTrailingSlash` is set,
   * a "Location" header will be set if the pathname needs to be changed.
   */
  headers?: HeadersInit

  /**
   * This option allows you to configure how the module handles dotfiles, i.e. files or directories that begin with a dot (".").
   * Dotfiles return a 403 by default (when this is set to "deny"), but this can be changed with this option.
   *
   * @default "deny"
   */
  dotfiles?: 'allow' | 'deny'

  /**
   * The default mime type to send in the "Content-Type" HTTP header, when the file's cannot be determined.
   *
   * @default "text/plain"
   */
  defaultMimeType?: string

  /**
   * The "Content-Type" HTTP header charset parameter.
   *
   * @default "utf-8"
   */
  charset?: string
}

/**
 * Options for serveStatic() when used as a middleware.
 */
interface ServeStaticMiddlewareOptions extends ServeStaticBaseOptions {
  /**
   * The type of middleware to generate.
   * When set to `"bao"`, it will return a Bao.js compatible handler function instead.
   */
  middlewareMode: 'bao'

  /**
   * If set to `false`, in the case of a 403 or 404 response, the unmodified context will be returned to Bao.js.
   * This allows you to handle the error yourself.
   *
   * If set to `true`, the error response will be sent to the client, without continuing the middleware chain.
   *
   * @default false
   */
  handleErrors?: boolean
}

type ServeStaticOptions = ServeStaticBaseOptions | ServeStaticMiddlewareOptions

/**
 * Get the correct pathname from the requested URL.
 * @param url The requested URL
 * @param stripFromPathname The string to remove from the pathname, if necessary
 */
function getPathname(
  { pathname }: URL,
  stripFromPathname: ServeStaticBaseOptions['stripFromPathname']
) {
  return stripFromPathname ? pathname.replace(stripFromPathname, '') : pathname
}

/**
 * Get the normalized path to redirect to.
 * @param pathname The requested pathname
 * @param requestedFile The requested file
 * @param options The serveStatic() options
 */
async function getRedirectPath(
  pathname: string,
  { isFile }: FileInfo,
  {
    collapseSlashes,
    dirTrailingSlash,
  }: Pick<ServeStaticBaseOptions, 'collapseSlashes' | 'dirTrailingSlash'>
) {
  let redirectPath = pathname

  // Normalize slashes
  if (collapseSlashes) {
    const pkg = await import('./utils/collapse-slashes')
    redirectPath = pkg.collapseSlashes(redirectPath, {
      keepTrailing: redirectPath.endsWith('/'), // Preserve trailing slash if it exists
    })
  }

  // Add trailing slash
  if (dirTrailingSlash && !isFile && !redirectPath.endsWith('/')) {
    redirectPath = `${redirectPath}/`
  }

  return redirectPath
}

/**
 * Get the file to serve, either the requested file or the folder's index file.
 * @param pathname The requested pathname
 * @param requestedFile The requested file
 * @param root The root path
 * @param options The serveStatic() options
 * @returns The file to serve, or null if none exists
 */
async function getFileToServe(
  pathname: string,
  requestedFile: FileInfo,
  root: string,
  { index, dotfiles }: Pick<ServeStaticBaseOptions, 'index' | 'dotfiles'>
) {
  const isDotfile = pathname.split('/').pop()?.startsWith('.')
  if (requestedFile.isFile && (!isDotfile || dotfiles === 'allow')) {
    return requestedFile
  }

  // If it is a folder and it has an index
  const indexFile =
    index === null ? null : await getFileInfo(`${root}/${pathname}/${index}`)
  if (indexFile?.exists && indexFile.isFile) {
    return indexFile
  }

  return null
}

/**
 * For use with {@link Bun.serve}'s fetch function directly.
 *
 * @example
 *
 * ```ts
 * import serveStatic from "serve-static-bun";
 *
 * Bun.serve({ fetch: serveStatic("frontend") });
 * ```
 * @param root The path to the static files to serve
 * @param options
 */
export default function serveStatic(
  root: string,
  options?: ServeStaticBaseOptions
): (req: Request) => Promise<Response>

export default function serveStatic(
  root: string,
  options: ServeStaticOptions = {}
) {
  if (!path.isAbsolute(root)) {
    root = `${process.cwd()}/${root}`
  }

  const {
    index = 'index.html',
    dirTrailingSlash = true,
    collapseSlashes = true,
    stripFromPathname,
    headers,
    dotfiles = 'deny',
    defaultMimeType = 'text/plain',
    charset = 'utf-8',
  } = options

  const getResponse = async (req: Request) => {
    const pathname = getPathname(new URL(req.url), stripFromPathname)
    const requestedFile = await getFileInfo(`${root}/${pathname}`)

    // If path does not exists, return 404
    if (!requestedFile.exists) {
      return new Response('404 Not Found', {
        status: 404,
        headers: {
          ...headers,
          'Content-Type': `text/plain; charset=${charset}`,
        },
      })
    }

    // Redirect to normalized path, if needed
    const redirectPath = await getRedirectPath(pathname, requestedFile, {
      collapseSlashes,
      dirTrailingSlash,
    })
    if (redirectPath !== pathname) {
      return new Response(undefined, {
        status: 308, // Permanent Redirect, cacheable
        headers: {
          ...headers,
          Location: redirectPath,
        },
      })
    }

    // Serve file or index, if one of them exists
    const fileToServe = await getFileToServe(pathname, requestedFile, root, {
      index,
      dotfiles,
    })
    if (fileToServe) {
      return new Response(fileToServe.blob, {
        headers: {
          ...headers,
          'Content-Type': `${fileToServe.mimeType ?? defaultMimeType}; charset=${charset}`,
        },
      })
    }

    // Fallback to 403
    return new Response('403 Forbidden', {
      status: 403,
      headers: {
        ...headers,
        'Content-Type': `text/plain; charset=${charset}`,
      },
    })
  }

  return getResponse
}
