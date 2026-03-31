

import z from 'zod/v4'

import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from '../../types/permissions.js'
import { lazySchema } from '../lazySchema.js'
import { externalPermissionModeSchema } from './PermissionMode.js'
import {
  permissionBehaviorSchema,
  permissionRuleValueSchema,
} from './PermissionRule.js'

export type { PermissionUpdate, PermissionUpdateDestination }

/**
 * PermissionUpdateDestination is where a new permission rule should be saved to.
 */
export const permissionUpdateDestinationSchema = lazySchema(() =>
  z.enum([
    
    'userSettings',
    // Project settings (shared per-directory)
    'projectSettings',
    // Local settings (gitignored)
    'localSettings',
    // In-memory for the current session only
    'session',
    // From the command line arguments
    'cliArg',
  ]),
)

export const permissionUpdateSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('addRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('replaceRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('setMode'),
      mode: externalPermissionModeSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: permissionUpdateDestinationSchema(),
    }),
  ]),
)
