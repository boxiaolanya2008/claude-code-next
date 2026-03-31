import type { ReactNode } from 'react'
import { logForDebugging } from 'src/utils/debug.js'
import { Stream } from 'stream'
import type { FrameEvent } from './frame.js'
import Ink, { type Options as InkOptions } from './ink.js'
import instances from './instances.js'

export type RenderOptions = {
  /**
   * Output stream where app will be rendered.
   *
   * @default process.stdout
   */
  stdout?: NodeJS.WriteStream
  

  stdin?: NodeJS.ReadStream
  

  stderr?: NodeJS.WriteStream
  

  exitOnCtrlC?: boolean

  

  patchConsole?: boolean

  

  onFrame?: (event: FrameEvent) => void
}

export type Instance = {
  /**
   * Replace previous root node with a new one or update props of the current root node.
   */
  rerender: Ink['render']
  

  unmount: Ink['unmount']
  

  waitUntilExit: Ink['waitUntilExit']
  cleanup: () => void
}

/**
 * A managed Ink root, similar to react-dom's createRoot API.
 * Separates instance creation from rendering so the same root
 * can be reused for multiple sequential screens.
 */
export type Root = {
  render: (node: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
}

/**
 * Mount a component and render the output.
 */
export const renderSync = (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Instance => {
  const opts = getOptions(options)
  const inkOptions: InkOptions = {
    stdout: process.stdout,
    stdin: process.stdin,
    stderr: process.stderr,
    exitOnCtrlC: true,
    patchConsole: true,
    ...opts,
  }

  const instance: Ink = getInstance(
    inkOptions.stdout,
    () => new Ink(inkOptions),
  )

  instance.render(node)

  return {
    rerender: instance.render,
    unmount() {
      instance.unmount()
    },
    waitUntilExit: instance.waitUntilExit,
    cleanup: () => instances.delete(inkOptions.stdout),
  }
}

const wrappedRender = async (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> => {
  // Preserve the microtask boundary that `await loadYoga()` used to provide.
  
  
  
  await Promise.resolve()
  const instance = renderSync(node, options)
  logForDebugging(
    `[render] first ink render: ${Math.round(process.uptime() * 1000)}ms since process start`,
  )
  return instance
}

export default wrappedRender

export async function createRoot({
  stdout = process.stdout,
  stdin = process.stdin,
  stderr = process.stderr,
  exitOnCtrlC = true,
  patchConsole = true,
  onFrame,
}: RenderOptions = {}): Promise<Root> {
  // See wrappedRender — preserve microtask boundary from the old WASM await.
  await Promise.resolve()
  const instance = new Ink({
    stdout,
    stdin,
    stderr,
    exitOnCtrlC,
    patchConsole,
    onFrame,
  })

  
  
  instances.set(stdout, instance)

  return {
    render: node => instance.render(node),
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
  }
}

const getOptions = (
  stdout: NodeJS.WriteStream | RenderOptions | undefined = {},
): RenderOptions => {
  if (stdout instanceof Stream) {
    return {
      stdout,
      stdin: process.stdin,
    }
  }

  return stdout
}

const getInstance = (
  stdout: NodeJS.WriteStream,
  createInstance: () => Ink,
): Ink => {
  let instance = instances.get(stdout)

  if (!instance) {
    instance = createInstance()
    instances.set(stdout, instance)
  }

  return instance
}
