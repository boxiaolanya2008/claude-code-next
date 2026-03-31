import memoize from 'lodash-es/memoize.js'
import { basename } from 'path'
import type { OutputStyleConfig } from '../../constants/outputStyles.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import {
  coerceDescriptionToString,
  parseFrontmatter,
} from '../frontmatterParser.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'
import { extractDescriptionFromMarkdown } from '../markdownConfigLoader.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'

async function loadOutputStylesFromDirectory(
  outputStylesPath: string,
  pluginName: string,
  loadedPaths: Set<string>,
): Promise<OutputStyleConfig[]> {
  const styles: OutputStyleConfig[] = []
  await walkPluginMarkdown(
    outputStylesPath,
    async fullPath => {
      const style = await loadOutputStyleFromFile(
        fullPath,
        pluginName,
        loadedPaths,
      )
      if (style) styles.push(style)
    },
    { logLabel: 'output-styles' },
  )
  return styles
}

async function loadOutputStyleFromFile(
  filePath: string,
  pluginName: string,
  loadedPaths: Set<string>,
): Promise<OutputStyleConfig | null> {
  const fs = getFsImplementation()
  if (isDuplicatePath(fs, filePath, loadedPaths)) {
    return null
  }
  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' })
    const { frontmatter, content: markdownContent } = parseFrontmatter(
      content,
      filePath,
    )

    const fileName = basename(filePath, '.md')
    const baseStyleName = (frontmatter.name as string) || fileName
    
    const name = `${pluginName}:${baseStyleName}`
    const description =
      coerceDescriptionToString(frontmatter.description, name) ??
      extractDescriptionFromMarkdown(
        markdownContent,
        `Output style from ${pluginName} plugin`,
      )

    
    const forceRaw = frontmatter['force-for-plugin']
    const forceForPlugin =
      forceRaw === true || forceRaw === 'true'
        ? true
        : forceRaw === false || forceRaw === 'false'
          ? false
          : undefined

    return {
      name,
      description,
      prompt: markdownContent.trim(),
      source: 'plugin',
      forceForPlugin,
    }
  } catch (error) {
    logForDebugging(`Failed to load output style from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}

export const loadPluginOutputStyles = memoize(
  async (): Promise<OutputStyleConfig[]> => {
    
    const { enabled, errors } = await loadAllPluginsCacheOnly()
    const allStyles: OutputStyleConfig[] = []

    if (errors.length > 0) {
      logForDebugging(
        `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
      )
    }

    for (const plugin of enabled) {
      
      const loadedPaths = new Set<string>()

      
      if (plugin.outputStylesPath) {
        try {
          const styles = await loadOutputStylesFromDirectory(
            plugin.outputStylesPath,
            plugin.name,
            loadedPaths,
          )
          allStyles.push(...styles)

          if (styles.length > 0) {
            logForDebugging(
              `Loaded ${styles.length} output styles from plugin ${plugin.name} default directory`,
            )
          }
        } catch (error) {
          logForDebugging(
            `Failed to load output styles from plugin ${plugin.name} default directory: ${error}`,
            { level: 'error' },
          )
        }
      }

      
      if (plugin.outputStylesPaths) {
        for (const stylePath of plugin.outputStylesPaths) {
          try {
            const fs = getFsImplementation()
            const stats = await fs.stat(stylePath)

            if (stats.isDirectory()) {
              
              const styles = await loadOutputStylesFromDirectory(
                stylePath,
                plugin.name,
                loadedPaths,
              )
              allStyles.push(...styles)

              if (styles.length > 0) {
                logForDebugging(
                  `Loaded ${styles.length} output styles from plugin ${plugin.name} custom path: ${stylePath}`,
                )
              }
            } else if (stats.isFile() && stylePath.endsWith('.md')) {
              
              const style = await loadOutputStyleFromFile(
                stylePath,
                plugin.name,
                loadedPaths,
              )
              if (style) {
                allStyles.push(style)
                logForDebugging(
                  `Loaded output style from plugin ${plugin.name} custom file: ${stylePath}`,
                )
              }
            }
          } catch (error) {
            logForDebugging(
              `Failed to load output styles from plugin ${plugin.name} custom path ${stylePath}: ${error}`,
              { level: 'error' },
            )
          }
        }
      }
    }

    logForDebugging(`Total plugin output styles loaded: ${allStyles.length}`)
    return allStyles
  },
)

export function clearPluginOutputStyleCache(): void {
  loadPluginOutputStyles.cache?.clear?.()
}
