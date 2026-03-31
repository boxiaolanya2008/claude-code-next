

import * as React from 'react';
import type { LoadedPlugin } from '../../types/plugin.js';
import { errorMessage } from '../../utils/errors.js';
import { loadMcpServerUserConfig, saveMcpServerUserConfig } from '../../utils/plugins/mcpbHandler.js';
import { getUnconfiguredChannels, type UnconfiguredChannel } from '../../utils/plugins/mcpPluginIntegration.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { getUnconfiguredOptions, loadPluginOptions, type PluginOptionSchema, type PluginOptionValues, savePluginOptions } from '../../utils/plugins/pluginOptionsStorage.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';

export async function findPluginOptionsTarget(pluginId: string): Promise<LoadedPlugin | undefined> {
  const {
    enabled,
    disabled
  } = await loadAllPlugins();
  return [...enabled, ...disabled].find(p => p.repository === pluginId || p.source === pluginId);
}

type ConfigStep = {
  key: string;
  title: string;
  subtitle: string;
  schema: PluginOptionSchema;
  

  load: () => PluginOptionValues | undefined;
  save: (values: PluginOptionValues) => void;
};
type Props = {
  plugin: LoadedPlugin;
  
  pluginId: string;
  

  onDone: (outcome: 'configured' | 'skipped' | 'error', detail?: string) => void;
};
export function PluginOptionsFlow({
  plugin,
  pluginId,
  onDone
}: Props): React.ReactNode {
  
  
  const [steps] = React.useState<ConfigStep[]>(() => {
    const result: ConfigStep[] = [];

    
    const unconfigured = getUnconfiguredOptions(plugin);
    if (Object.keys(unconfigured).length > 0) {
      result.push({
        key: 'top-level',
        title: `Configure ${plugin.name}`,
        subtitle: 'Plugin options',
        schema: unconfigured,
        load: () => loadPluginOptions(pluginId),
        save: values => savePluginOptions(pluginId, values, plugin.manifest.userConfig!)
      });
    }

    
    const channels: UnconfiguredChannel[] = getUnconfiguredChannels(plugin);
    for (const channel of channels) {
      result.push({
        key: `channel:${channel.server}`,
        title: `Configure ${channel.displayName}`,
        subtitle: `Plugin: ${plugin.name}`,
        schema: channel.configSchema,
        load: () => loadMcpServerUserConfig(pluginId, channel.server) ?? undefined,
        save: values_0 => saveMcpServerUserConfig(pluginId, channel.server, values_0, channel.configSchema)
      });
    }
    return result;
  });
  const [index, setIndex] = React.useState(0);

  
  
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  
  
  
  React.useEffect(() => {
    if (steps.length === 0) {
      onDoneRef.current('skipped');
    }
  }, [steps.length]);
  if (steps.length === 0) {
    return null;
  }
  const current = steps[index]!;
  function handleSave(values_1: PluginOptionValues): void {
    try {
      current.save(values_1);
    } catch (err) {
      onDone('error', errorMessage(err));
      return;
    }
    const next = index + 1;
    if (next < steps.length) {
      setIndex(next);
    } else {
      onDone('configured');
    }
  }

  
  
  
  return <PluginOptionsDialog key={current.key} title={current.title} subtitle={current.subtitle} configSchema={current.schema} initialValues={current.load()} onSave={handleSave} onCancel={() => onDone('skipped')} />;
}
