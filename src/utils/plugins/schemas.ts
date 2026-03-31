import { z } from 'zod/v4'
import { HooksSchema } from '../../schemas/hooks.js'
import { McpServerConfigSchema } from '../../services/mcp/types.js'
import { lazySchema } from '../lazySchema.js'

export const ALLOWED_OFFICIAL_MARKETPLACE_NAMES = new Set([
  'claude-code-next-marketplace',
  'claude-code-next-plugins',
  'claude-plugins-official',
  'anthropic-marketplace',
  'anthropic-plugins',
  'agent-skills',
  'life-sciences',
  'knowledge-work-plugins',
])

const NO_AUTO_UPDATE_OFFICIAL_MARKETPLACES = new Set(['knowledge-work-plugins'])

export function isMarketplaceAutoUpdate(
  marketplaceName: string,
  entry: { autoUpdate?: boolean },
): boolean {
  const normalizedName = marketplaceName.toLowerCase()
  return (
    entry.autoUpdate ??
    (ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(normalizedName) &&
      !NO_AUTO_UPDATE_OFFICIAL_MARKETPLACES.has(normalizedName))
  )
}

export const BLOCKED_OFFICIAL_NAME_PATTERN =
  /(?:official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official|^(?:anthropic|claude)[^a-z0-9]*(marketplace|plugins|official))/i

const NON_ASCII_PATTERN = /[^\u0020-\u007E]/

export function isBlockedOfficialName(name: string): boolean {
  
  if (ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(name.toLowerCase())) {
    return false
  }

  
  
  if (NON_ASCII_PATTERN.test(name)) {
    return true
  }

  
  return BLOCKED_OFFICIAL_NAME_PATTERN.test(name)
}

export const OFFICIAL_GITHUB_ORG = 'anthropics'

export function validateOfficialNameSource(
  name: string,
  source: { source: string; repo?: string; url?: string },
): string | null {
  const normalizedName = name.toLowerCase()

  
  if (!ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(normalizedName)) {
    return null 
  }

  
  if (source.source === 'github') {
    
    const repo = source.repo || ''
    if (!repo.toLowerCase().startsWith(`${OFFICIAL_GITHUB_ORG}/`)) {
      return `The name '${name}' is reserved for official Anthropic marketplaces. Only repositories from 'github.com/${OFFICIAL_GITHUB_ORG}/' can use this name.`
    }
    return null 
  }

  
  if (source.source === 'git' && source.url) {
    const url = source.url.toLowerCase()
    
    
    const isHttpsAnthropics = url.includes('github.com/anthropics/')
    const isSshAnthropics = url.includes('git@github.com:anthropics/')

    if (isHttpsAnthropics || isSshAnthropics) {
      return null 
    }

    return `The name '${name}' is reserved for official Anthropic marketplaces. Only repositories from 'github.com/${OFFICIAL_GITHUB_ORG}/' can use this name.`
  }

  
  return `The name '${name}' is reserved for official Anthropic marketplaces and can only be used with GitHub sources from the '${OFFICIAL_GITHUB_ORG}' organization.`
}

const RelativePath = lazySchema(() => z.string().startsWith('./'))

const RelativeJSONPath = lazySchema(() => RelativePath().endsWith('.json'))

const McpbPath = lazySchema(() =>
  z.union([
    RelativePath()
      .refine(path => path.endsWith('.mcpb') || path.endsWith('.dxt'), {
        message: 'MCPB file path must end with .mcpb or .dxt',
      })
      .describe('Path to MCPB file relative to plugin root'),
    z
      .string()
      .url()
      .refine(url => url.endsWith('.mcpb') || url.endsWith('.dxt'), {
        message: 'MCPB URL must end with .mcpb or .dxt',
      })
      .describe('URL to MCPB file'),
  ]),
)

const RelativeMarkdownPath = lazySchema(() => RelativePath().endsWith('.md'))

const RelativeCommandPath = lazySchema(() =>
  z.union([
    RelativeMarkdownPath(),
    RelativePath(), 
  ]),
)

const MarketplaceNameSchema = lazySchema(() =>
  z
    .string()
    .min(1, 'Marketplace must have a name')
    .refine(name => !name.includes(' '), {
      message:
        'Marketplace name cannot contain spaces. Use kebab-case (e.g., "my-marketplace")',
    })
    .refine(
      name =>
        !name.includes('/') &&
        !name.includes('\\') &&
        !name.includes('..') &&
        name !== '.',
      {
        message:
          'Marketplace name cannot contain path separators (/ or \\), ".." sequences, or be "."',
      },
    )
    .refine(name => !isBlockedOfficialName(name), {
      message:
        'Marketplace name impersonates an official Anthropic/Claude marketplace',
    })
    .refine(name => name.toLowerCase() !== 'inline', {
      message:
        'Marketplace name "inline" is reserved for --plugin-dir session plugins',
    })
    .refine(name => name.toLowerCase() !== 'builtin', {
      message: 'Marketplace name "builtin" is reserved for built-in plugins',
    }),
)

export const PluginAuthorSchema = lazySchema(() =>
  z.object({
    name: z
      .string()
      .min(1, 'Author name cannot be empty')
      .describe('Display name of the plugin author or organization'),
    email: z
      .string()
      .optional()
      .describe('Contact email for support or feedback'),
    url: z
      .string()
      .optional()
      .describe('Website, GitHub profile, or organization URL'),
  }),
)

const PluginManifestMetadataSchema = lazySchema(() =>
  z.object({
    name: z
      .string()
      .min(1, 'Plugin name cannot be empty')
      .refine(name => !name.includes(' '), {
        message:
          'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
      })
      .describe(
        'Unique identifier for the plugin, used for namespacing (prefer kebab-case)',
      ),
    version: z
      .string()
      .optional()
      .describe(
        'Semantic version (e.g., 1.2.3) following semver.org specification',
      ),
    description: z
      .string()
      .optional()
      .describe('Brief, user-facing explanation of what the plugin provides'),
    author: PluginAuthorSchema()
      .optional()
      .describe('Information about the plugin creator or maintainer'),
    homepage: z
      .string()
      .url()
      .optional()
      .describe('Plugin homepage or documentation URL'),
    repository: z.string().optional().describe('Source code repository URL'),
    license: z
      .string()
      .optional()
      .describe('SPDX license identifier (e.g., MIT, Apache-2.0)'),
    keywords: z
      .array(z.string())
      .optional()
      .describe('Tags for plugin discovery and categorization'),
    dependencies: z
      .array(DependencyRefSchema())
      .optional()
      .describe(
        'Plugins that must be enabled for this plugin to function. Bare names (no "@marketplace") are resolved against the declaring plugin\'s own marketplace.',
      ),
  }),
)

export const PluginHooksSchema = lazySchema(() =>
  z.object({
    description: z
      .string()
      .optional()
      .describe('Brief, user-facing explanation of what these hooks provide'),
    hooks: z
      .lazy(() => HooksSchema())
      .describe(
        'The hooks provided by the plugin, in the same format as the one used for settings',
      ),
  }),
)

const PluginManifestHooksSchema = lazySchema(() =>
  z.object({
    hooks: z.union([
      RelativeJSONPath().describe(
        'Path to file with additional hooks (in addition to those in hooks/hooks.json, if it exists), relative to the plugin root',
      ),
      z
        .lazy(() => HooksSchema())
        .describe(
          'Additional hooks (in addition to those in hooks/hooks.json, if it exists)',
        ),
      z.array(
        z.union([
          RelativeJSONPath().describe(
            'Path to file with additional hooks (in addition to those in hooks/hooks.json, if it exists), relative to the plugin root',
          ),
          z
            .lazy(() => HooksSchema())
            .describe(
              'Additional hooks (in addition to those in hooks/hooks.json, if it exists)',
            ),
        ]),
      ),
    ]),
  }),
)

export const CommandMetadataSchema = lazySchema(() =>
  z
    .object({
      source: RelativeCommandPath()
        .optional()
        .describe('Path to command markdown file, relative to plugin root'),
      content: z
        .string()
        .optional()
        .describe('Inline markdown content for the command'),
      description: z
        .string()
        .optional()
        .describe('Command description override'),
      argumentHint: z
        .string()
        .optional()
        .describe('Hint for command arguments (e.g., "[file]")'),
      model: z.string().optional().describe('Default model for this command'),
      allowedTools: z
        .array(z.string())
        .optional()
        .describe('Tools allowed when command runs'),
    })
    .refine(
      data => (data.source && !data.content) || (!data.source && data.content),
      {
        message:
          'Command must have either "source" (file path) or "content" (inline markdown), but not both',
      },
    ),
)

const PluginManifestCommandsSchema = lazySchema(() =>
  z.object({
    commands: z.union([
      
      RelativeCommandPath().describe(
        'Path to additional command file or skill directory (in addition to those in the commands/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativeCommandPath().describe(
            'Path to additional command file or skill directory (in addition to those in the commands/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe(
          'List of paths to additional command files or skill directories',
        ),
      z
        .record(z.string(), CommandMetadataSchema())
        .describe(
          'Object mapping of command names to their metadata and source files. Command name becomes the slash command name (e.g., "about" → "/plugin:about")',
        ),
    ]),
  }),
)

const PluginManifestAgentsSchema = lazySchema(() =>
  z.object({
    agents: z.union([
      
      RelativeMarkdownPath().describe(
        'Path to additional agent file (in addition to those in the agents/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativeMarkdownPath().describe(
            'Path to additional agent file (in addition to those in the agents/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe('List of paths to additional agent files'),
    ]),
  }),
)

const PluginManifestSkillsSchema = lazySchema(() =>
  z.object({
    skills: z.union([
      RelativePath().describe(
        'Path to additional skill directory (in addition to those in the skills/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativePath().describe(
            'Path to additional skill directory (in addition to those in the skills/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe('List of paths to additional skill directories'),
    ]),
  }),
)

const PluginManifestOutputStylesSchema = lazySchema(() =>
  z.object({
    outputStyles: z.union([
      RelativePath().describe(
        'Path to additional output styles directory or file (in addition to those in the output-styles/ directory, if it exists), relative to the plugin root',
      ),
      z
        .array(
          RelativePath().describe(
            'Path to additional output styles directory or file (in addition to those in the output-styles/ directory, if it exists), relative to the plugin root',
          ),
        )
        .describe(
          'List of paths to additional output styles directories or files',
        ),
    ]),
  }),
)

const nonEmptyString = lazySchema(() => z.string().min(1))
const fileExtension = lazySchema(() =>
  z
    .string()
    .min(2)
    .refine(ext => ext.startsWith('.'), {
      message: 'File extensions must start with dot (e.g., ".ts", not "ts")',
    }),
)

const PluginManifestMcpServerSchema = lazySchema(() =>
  z.object({
    mcpServers: z.union([
      RelativeJSONPath().describe(
        'MCP servers to include in the plugin (in addition to those in the .mcp.json file, if it exists)',
      ),
      McpbPath().describe(
        'Path or URL to MCPB file containing MCP server configuration',
      ),
      z
        .record(z.string(), McpServerConfigSchema())
        .describe('MCP server configurations keyed by server name'),
      z
        .array(
          z.union([
            RelativeJSONPath().describe(
              'Path to MCP servers configuration file',
            ),
            McpbPath().describe('Path or URL to MCPB file'),
            z
              .record(z.string(), McpServerConfigSchema())
              .describe('Inline MCP server configurations'),
          ]),
        )
        .describe(
          'Array of MCP server configurations (paths, MCPB files, or inline definitions)',
        ),
    ]),
  }),
)

const PluginUserConfigOptionSchema = lazySchema(() =>
  z
    .object({
      type: z
        .enum(['string', 'number', 'boolean', 'directory', 'file'])
        .describe('Type of the configuration value'),
      title: z
        .string()
        .describe('Human-readable label shown in the config dialog'),
      description: z
        .string()
        .describe('Help text shown beneath the field in the config dialog'),
      required: z
        .boolean()
        .optional()
        .describe('If true, validation fails when this field is empty'),
      default: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
        .optional()
        .describe('Default value used when the user provides nothing'),
      multiple: z
        .boolean()
        .optional()
        .describe('For string type: allow an array of strings'),
      sensitive: z
        .boolean()
        .optional()
        .describe(
          'If true, masks dialog input and stores value in secure storage (keychain/credentials file) instead of settings.json',
        ),
      min: z.number().optional().describe('Minimum value (number type only)'),
      max: z.number().optional().describe('Maximum value (number type only)'),
    })
    .strict(),
)

const PluginManifestUserConfigSchema = lazySchema(() =>
  z.object({
    userConfig: z
      .record(
        z
          .string()
          .regex(
            /^[A-Za-z_]\w*$/,
            'Option keys must be valid identifiers (letters, digits, underscore; no leading digit) — they become CLAUDE_PLUGIN_OPTION_<KEY> env vars in hooks',
          ),
        PluginUserConfigOptionSchema(),
      )
      .optional()
      .describe(
        'User-configurable values this plugin needs. Prompted at enable time. ' +
          'Non-sensitive values saved to settings.json; sensitive values to secure storage ' +
          '(macOS keychain or .credentials.json). Available as ${user_config.KEY} in ' +
          'MCP/LSP server config, hook commands, and (non-sensitive only) skill/agent content. ' +
          'Note: sensitive values share a single keychain entry with OAuth tokens — keep ' +
          'secret counts small to stay under the ~2KB stdin-safe limit (see INC-3028).',
      ),
  }),
)

const PluginManifestChannelsSchema = lazySchema(() =>
  z.object({
    channels: z
      .array(
        z
          .object({
            server: z
              .string()
              .min(1)
              .describe(
                "Name of the MCP server this channel binds to. Must match a key in this plugin's mcpServers.",
              ),
            displayName: z
              .string()
              .optional()
              .describe(
                'Human-readable name shown in the config dialog title (e.g., "Telegram"). Defaults to the server name.',
              ),
            userConfig: z
              .record(z.string(), PluginUserConfigOptionSchema())
              .optional()
              .describe(
                'Fields to prompt the user for when enabling this plugin in assistant mode. ' +
                  'Saved values are substituted into ${user_config.KEY} references in the mcpServers env.',
              ),
          })
          .strict(),
      )
      .describe(
        'Channels this plugin provides. Each entry declares an MCP server as a message channel ' +
          'and optionally specifies user configuration to prompt for at enable time.',
      ),
  }),
)

export const LspServerConfigSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .min(1)
      .refine(
        cmd => {
          
          if (cmd.includes(' ') && !cmd.startsWith('/')) {
            return false
          }
          return true
        },
        {
          message:
            'Command should not contain spaces. Use args array for arguments.',
        },
      )
      .describe(
        'Command to execute the LSP server (e.g., "typescript-language-server")',
      ),
    args: z
      .array(nonEmptyString())
      .optional()
      .describe('Command-line arguments to pass to the server'),
    extensionToLanguage: z
      .record(fileExtension(), nonEmptyString())
      .refine(record => Object.keys(record).length > 0, {
        message: 'extensionToLanguage must have at least one mapping',
      })
      .describe(
        'Mapping from file extension to LSP language ID. File extensions and languages are derived from this mapping.',
      ),
    transport: z
      .enum(['stdio', 'socket'])
      .default('stdio')
      .describe('Communication transport mechanism'),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to set when starting the server'),
    initializationOptions: z
      .unknown()
      .optional()
      .describe(
        'Initialization options passed to the server during initialization',
      ),
    settings: z
      .unknown()
      .optional()
      .describe(
        'Settings passed to the server via workspace/didChangeConfiguration',
      ),
    workspaceFolder: z
      .string()
      .optional()
      .describe('Workspace folder path to use for the server'),
    startupTimeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum time to wait for server startup (milliseconds)'),
    shutdownTimeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum time to wait for graceful shutdown (milliseconds)'),
    restartOnCrash: z
      .boolean()
      .optional()
      .describe('Whether to restart the server if it crashes'),
    maxRestarts: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Maximum number of restart attempts before giving up'),
  }),
)

const PluginManifestLspServerSchema = lazySchema(() =>
  z.object({
    lspServers: z.union([
      RelativeJSONPath().describe(
        'Path to .lsp.json configuration file relative to plugin root',
      ),
      z
        .record(z.string(), LspServerConfigSchema())
        .describe('LSP server configurations keyed by server name'),
      z
        .array(
          z.union([
            RelativeJSONPath().describe('Path to LSP configuration file'),
            z
              .record(z.string(), LspServerConfigSchema())
              .describe('Inline LSP server configurations'),
          ]),
        )
        .describe(
          'Array of LSP server configurations (paths or inline definitions)',
        ),
    ]),
  }),
)

const NpmPackageNameSchema = lazySchema(() =>
  z
    .string()
    .refine(
      name => !name.includes('..') && !name.includes('//'),
      'Package name cannot contain path traversal patterns',
    )
    .refine(name => {
      
      const scopedPackageRegex = /^@[a-z0-9][a-z0-9-._]*\/[a-z0-9][a-z0-9-._]*$/
      const regularPackageRegex = /^[a-z0-9][a-z0-9-._]*$/
      return scopedPackageRegex.test(name) || regularPackageRegex.test(name)
    }, 'Invalid npm package name format'),
)

const PluginManifestSettingsSchema = lazySchema(() =>
  z.object({
    settings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Settings to merge when plugin is enabled. ' +
          'Only allowlisted keys are kept (currently: agent)',
      ),
  }),
)

export const PluginManifestSchema = lazySchema(() =>
  z.object({
    ...PluginManifestMetadataSchema().shape,
    ...PluginManifestHooksSchema().partial().shape,
    ...PluginManifestCommandsSchema().partial().shape,
    ...PluginManifestAgentsSchema().partial().shape,
    ...PluginManifestSkillsSchema().partial().shape,
    ...PluginManifestOutputStylesSchema().partial().shape,
    ...PluginManifestChannelsSchema().partial().shape,
    ...PluginManifestMcpServerSchema().partial().shape,
    ...PluginManifestLspServerSchema().partial().shape,
    ...PluginManifestSettingsSchema().partial().shape,
    ...PluginManifestUserConfigSchema().partial().shape,
  }),
)

export const MarketplaceSourceSchema = lazySchema(() =>
  z.discriminatedUnion('source', [
    z.object({
      source: z.literal('url'),
      url: z.string().url().describe('Direct URL to marketplace.json file'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Custom HTTP headers (e.g., for authentication)'),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string().describe('GitHub repository in owner/repo format'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'Path to marketplace.json within repo (defaults to .claude-plugin/marketplace.json)',
        ),
      sparsePaths: z
        .array(z.string())
        .optional()
        .describe(
          'Directories to include via git sparse-checkout (cone mode). ' +
            'Use for monorepos where the marketplace lives in a subdirectory. ' +
            'Example: [".claude-plugin", "plugins"]. ' +
            'If omitted, the full repository is cloned.',
        ),
    }),
    z.object({
      source: z.literal('git'),
      
      
      
      
      
      
      
      url: z.string().describe('Full git repository URL'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'Path to marketplace.json within repo (defaults to .claude-plugin/marketplace.json)',
        ),
      sparsePaths: z
        .array(z.string())
        .optional()
        .describe(
          'Directories to include via git sparse-checkout (cone mode). ' +
            'Use for monorepos where the marketplace lives in a subdirectory. ' +
            'Example: [".claude-plugin", "plugins"]. ' +
            'If omitted, the full repository is cloned.',
        ),
    }),
    z.object({
      source: z.literal('npm'),
      package: NpmPackageNameSchema().describe(
        'NPM package containing marketplace.json',
      ),
    }),
    z.object({
      source: z.literal('file'),
      path: z.string().describe('Local file path to marketplace.json'),
    }),
    z.object({
      source: z.literal('directory'),
      path: z
        .string()
        .describe('Local directory containing .claude-plugin/marketplace.json'),
    }),
    z.object({
      source: z.literal('hostPattern'),
      hostPattern: z
        .string()
        .describe(
          'Regex pattern to match the host/domain extracted from any marketplace source type. ' +
            'For github sources, matches against "github.com". For git sources (SSH or HTTPS), ' +
            'extracts the hostname from the URL. Use in strictKnownMarketplaces to allow all ' +
            'marketplaces from a specific host (e.g., "^github\\.mycompany\\.com$").',
        ),
    }),
    z.object({
      source: z.literal('pathPattern'),
      pathPattern: z
        .string()
        .describe(
          'Regex pattern matched against the .path field of file and directory sources. ' +
            'Use in strictKnownMarketplaces to allow filesystem-based marketplaces alongside ' +
            'hostPattern restrictions for network sources. Use ".*" to allow all filesystem ' +
            'paths, or a narrower pattern (e.g., "^/opt/approved/") to restrict to specific ' +
            'directories.',
        ),
    }),
    z
      .object({
        source: z.literal('settings'),
        name: MarketplaceNameSchema()
          .refine(
            name => !ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(name.toLowerCase()),
            {
              message:
                'Reserved official marketplace names cannot be used with settings sources. ' +
                'validateOfficialNameSource only accepts github/git sources from anthropics'
            }
          )
        })
      ])
    )

export const PluginSourceSchema = lazySchema(() =>
  z.union([
    RelativePath().describe(
      'Path to the plugin root, relative to the marketplace root (the directory containing .claude-plugin/, not .claude-plugin/ itself)',
    ),
    z
      .object({
        source: z.literal('npm'),
        package: NpmPackageNameSchema()
          .or(z.string()) 
          .describe(
            'Package name (or url, or local path, or anything else that can be passed to `npm` as a package)',
          ),
        version: z
          .string()
          .optional()
          .describe('Specific version or version range (e.g., ^1.0.0, ~2.1.0)'),
        registry: z
          .string()
          .url()
          .optional()
          .describe(
            'Custom NPM registry URL (defaults to using system default, likely npmjs.org)',
          ),
      })
      .describe('NPM package as plugin source'),
    z
      .object({
        source: z.literal('pip'),
        package: z
          .string()
          .describe('Python package name as it appears on PyPI'),
        version: z
          .string()
          .optional()
          .describe('Version specifier (e.g., ==1.0.0, >=2.0.0, <3.0.0)'),
        registry: z
          .string()
          .url()
          .optional()
          .describe(
            'Custom PyPI registry URL (defaults to using system default, likely pypi.org)',
          ),
      })
      .describe('Python package as plugin source'),
    z.object({
      source: z.literal('url'),
      
      url: z.string().describe('Full git repository URL (https://github.com/anthropics/claude-code-next.git)'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      sha: gitSha().optional().describe('Specific commit SHA to use'),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string().describe('GitHub repository in owner/repo format'),
      ref: z
        .string()
        .optional()
        .describe(
          'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
        ),
      sha: gitSha().optional().describe('Specific commit SHA to use'),
    }),
    z
      .object({
        source: z.literal('git-subdir'),
        url: z
          .string()
          .describe(
            'Git repository: GitHub owner/repo shorthand, https://, or git@ URL',
          ),
        path: z
          .string()
          .min(1)
          .describe(
            'Subdirectory within the repo containing the plugin (e.g., "tools/claude-plugin"). ' +
              'Cloned sparsely using partial clone (--filter=tree:0) to minimize bandwidth for monorepos.',
          ),
        ref: z
          .string()
          .optional()
          .describe(
            'Git branch or tag to use (e.g., "main", "v1.0.0"). Defaults to repository default branch.',
          ),
        sha: gitSha().optional().describe('Specific commit SHA to use'),
      })
      .describe(
        'Plugin located in a subdirectory of a larger repository (monorepo). ' +
          'Only the specified subdirectory is materialized; the rest of the repo is not downloaded.',
      ),
    
    
  ]),
)

const SettingsMarketplacePluginSchema = lazySchema(() =>
  z
    .object({
      name: z
        .string()
        .min(1, 'Plugin name cannot be empty')
        .refine(name => !name.includes(' '), {
          message:
            'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
        })
        .describe('Plugin name as it appears in the target repository'),
      source: PluginSourceSchema().describe(
        'Where to fetch the plugin from. Must be a remote source — relative ' +
          'paths have no marketplace repository to resolve against.',
      ),
      description: z.string().optional(),
      version: z.string().optional(),
      strict: z.boolean().optional(),
    })
    .refine(p => typeof p.source !== 'string', {
      message:
        'Plugins in a settings-sourced marketplace must use remote sources ' +
        '(github, git-subdir, npm, url, pip). Relative-path sources like "./foo" ' +
        'have no marketplace repository to resolve against.',
    }),
)

export function isLocalPluginSource(source: PluginSource): source is string {
  return typeof source === 'string' && source.startsWith('./')
}

export function isLocalMarketplaceSource(
  source: MarketplaceSource,
): source is Extract<MarketplaceSource, { source: 'file' | 'directory' }> {
  return source.source === 'file' || source.source === 'directory'
}

export const PluginMarketplaceEntrySchema = lazySchema(() =>
  PluginManifestSchema()
    .partial()
    .extend({
      name: z
        .string()
        .min(1, 'Plugin name cannot be empty')
        .refine(name => !name.includes(' '), {
          message:
            'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
        })
        .describe('Unique identifier matching the plugin name'),
      source: PluginSourceSchema().describe('Where to fetch the plugin from'),
      category: z
        .string()
        .optional()
        .describe(
          'Category for organizing plugins (e.g., "productivity", "development")',
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Tags for searchability and discovery'),
      strict: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'Require the plugin manifest to be present in the plugin folder. If false, the marketplace entry provides the manifest.',
        ),
    }),
)

export const PluginMarketplaceSchema = lazySchema(() =>
  z.object({
    name: MarketplaceNameSchema(),
    owner: PluginAuthorSchema().describe(
      'Marketplace maintainer or curator information',
    ),
    plugins: z
      .array(PluginMarketplaceEntrySchema())
      .describe('Collection of available plugins in this marketplace'),
    forceRemoveDeletedPlugins: z
      .boolean()
      .optional()
      .describe(
        'When true, plugins removed from this marketplace will be automatically uninstalled and flagged for users',
      ),
    metadata: z
      .object({
        pluginRoot: z
          .string()
          .optional()
          .describe('Base path for relative plugin sources'),
        version: z.string().optional().describe('Marketplace version'),
        description: z.string().optional().describe('Marketplace description'),
      })
      .optional()
      .describe('Optional marketplace metadata'),
    allowCrossMarketplaceDependenciesOn: z
      .array(z.string())
      .optional()
      .describe(
        "Marketplace names whose plugins may be auto-installed as dependencies. Only the root marketplace's allowlist applies \u2014 no transitive trust.",
      ),
  }),
)

export const PluginIdSchema = lazySchema(() =>
  z
    .string()
    .regex(
      /^[a-z0-9][-a-z0-9._]*@[a-z0-9][-a-z0-9._]*$/i,
      'Plugin ID must be in format: plugin@marketplace',
    ),
)

const DEP_REF_REGEX =
  /^[a-z0-9][-a-z0-9._]*(@[a-z0-9][-a-z0-9._]*)?(@\^[^@]*)?$/i

export const DependencyRefSchema = lazySchema(() =>
  z.union([
    z
      .string()
      .regex(
        DEP_REF_REGEX,
        'Dependency must be a plugin name, optionally qualified with @marketplace',
      )
      .transform(s => s.replace(/@\^[^@]*$/, '')),
    z
      .object({
        name: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][-a-z0-9._]*$/i),
        marketplace: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][-a-z0-9._]*$/i)
          .optional(),
      })
      .loose()
      .transform(o => (o.marketplace ? `${o.name}@${o.marketplace}` : o.name)),
  ]),
)

export const SettingsPluginEntrySchema = lazySchema(() =>
  z.union([
    
    PluginIdSchema(),
    
    z.object({
      id: PluginIdSchema().describe(
        'Plugin identifier (e.g., "formatter@tools")',
      ),
      version: z
        .string()
        .optional()
        .describe('Version constraint (e.g., "^2.0.0")'),
      required: z.boolean().optional().describe('If true, cannot be disabled'),
      config: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Plugin-specific configuration'),
    }),
  ]),
)

export const InstalledPluginSchema = lazySchema(() =>
  z.object({
    version: z.string().describe('Currently installed version'),
    installedAt: z.string().describe('ISO 8601 timestamp of installation'),
    lastUpdated: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp of last update'),
    installPath: z
      .string()
      .describe('Absolute path to the installed plugin directory'),
    gitCommitSha: z
      .string()
      .optional()
      .describe('Git commit SHA for git-based plugins (for version tracking)'),
  }),
)

export const InstalledPluginsFileSchemaV1 = lazySchema(() =>
  z.object({
    version: z.literal(1).describe('Schema version 1'),
    plugins: z
      .record(
        PluginIdSchema(), 
        InstalledPluginSchema(),
      )
      .describe('Map of plugin IDs to their installation metadata'),
  }),
)

export const PluginScopeSchema = lazySchema(() =>
  z.enum(['managed', 'user', 'project', 'local']),
)

export const PluginInstallationEntrySchema = lazySchema(() =>
  z.object({
    scope: PluginScopeSchema().describe('Installation scope'),
    projectPath: z
      .string()
      .optional()
      .describe('Project path (required for project/local scopes)'),
    installPath: z
      .string()
      .describe('Absolute path to the versioned plugin directory'),
    
    version: z.string().optional().describe('Currently installed version'),
    installedAt: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp of installation'),
    lastUpdated: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp of last update'),
    gitCommitSha: z
      .string()
      .optional()
      .describe('Git commit SHA for git-based plugins'),
  }),
)

export const InstalledPluginsFileSchemaV2 = lazySchema(() =>
  z.object({
    version: z.literal(2).describe('Schema version 2'),
    plugins: z
      .record(PluginIdSchema(), z.array(PluginInstallationEntrySchema()))
      .describe('Map of plugin IDs to arrays of installation entries'),
  }),
)

export const InstalledPluginsFileSchema = lazySchema(() =>
  z.union([InstalledPluginsFileSchemaV1(), InstalledPluginsFileSchemaV2()]),
)

export const KnownMarketplaceSchema = lazySchema(() =>
  z.object({
    source: MarketplaceSourceSchema().describe(
      'Where to fetch the marketplace from',
    ),
    installLocation: z
      .string()
      .describe('Local cache path where marketplace manifest is stored'),
    lastUpdated: z
      .string()
      .describe('ISO 8601 timestamp of last marketplace refresh'),
    autoUpdate: z
      .boolean()
      .optional()
      .describe(
        'Whether to automatically update this marketplace and its installed plugins on startup',
      ),
  }),
)

export const KnownMarketplacesFileSchema = lazySchema(() =>
  z.record(
    z.string(), 
    KnownMarketplaceSchema(),
  ),
)

export type CommandMetadata = z.infer<ReturnType<typeof CommandMetadataSchema>>
export type MarketplaceSource = z.infer<
  ReturnType<typeof MarketplaceSourceSchema>
>
export type PluginAuthor = z.infer<ReturnType<typeof PluginAuthorSchema>>
export type PluginSource = z.infer<ReturnType<typeof PluginSourceSchema>>
export type PluginManifest = z.infer<ReturnType<typeof PluginManifestSchema>>
export type PluginManifestChannel = NonNullable<
  PluginManifest['channels']
>[number]

export type PluginMarketplace = z.infer<
  ReturnType<typeof PluginMarketplaceSchema>
>
export type PluginMarketplaceEntry = z.infer<
  ReturnType<typeof PluginMarketplaceEntrySchema>
>
export type PluginId = z.infer<ReturnType<typeof PluginIdSchema>> 
export type InstalledPlugin = z.infer<ReturnType<typeof InstalledPluginSchema>>
export type InstalledPluginsFileV1 = z.infer<
  ReturnType<typeof InstalledPluginsFileSchemaV1>
>
export type InstalledPluginsFileV2 = z.infer<
  ReturnType<typeof InstalledPluginsFileSchemaV2>
>
export type PluginScope = z.infer<ReturnType<typeof PluginScopeSchema>>
export type PluginInstallationEntry = z.infer<
  ReturnType<typeof PluginInstallationEntrySchema>
>
export type KnownMarketplace = z.infer<
  ReturnType<typeof KnownMarketplaceSchema>
>
export type KnownMarketplacesFile = z.infer<
  ReturnType<typeof KnownMarketplacesFileSchema>
> 
