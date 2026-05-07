import {
  CheckIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import {
  CoworkAgentEngine,
  ExternalAgentConfigSource,
} from '@shared/cowork/constants';
import React from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type {
  ExternalAgentProvider,
  ExternalAgentProviderAppType,
  ExternalAgentProviderListResult,
} from '../../types/cowork';
import ModelSelector from '../ModelSelector';

interface CoworkModelSelectorProps {
  dropdownDirection?: 'up' | 'down';
}

const resolveLocalCliAppType = (config: RootState['cowork']['config']): ExternalAgentProviderAppType | null => {
  if (
    config.agentEngine === CoworkAgentEngine.ClaudeCode
    && config.claudeCodeConfigSource === ExternalAgentConfigSource.LocalCli
  ) {
    return 'claude';
  }
  if (
    config.agentEngine === CoworkAgentEngine.Codex
    && config.codexConfigSource === ExternalAgentConfigSource.LocalCli
  ) {
    return 'codex';
  }
  return null;
};

const getProviderModelLabel = (provider: ExternalAgentProvider | null): string => {
  if (!provider) return i18nService.t('coworkAgentLocalModelUnknown');
  return provider.summary.model
    ? `${provider.name} · ${provider.summary.model}`
    : provider.name;
};

const CoworkModelSelector: React.FC<CoworkModelSelectorProps> = ({
  dropdownDirection = 'down',
}) => {
  const config = useSelector((state: RootState) => state.cowork.config);
  const appType = resolveLocalCliAppType(config);
  const [isOpen, setIsOpen] = React.useState(false);
  const [providerResult, setProviderResult] = React.useState<ExternalAgentProviderListResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [switchingProviderId, setSwitchingProviderId] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const loadProviders = React.useCallback(async () => {
    if (!appType) return;
    setIsLoading(true);
    try {
      const result = await coworkService.listAgentProviders(appType);
      if (result.success) {
        setProviderResult(result);
      }
    } finally {
      setIsLoading(false);
    }
  }, [appType]);

  React.useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  React.useEffect(() => {
    const handleChanged = () => {
      void loadProviders();
    };
    window.addEventListener('wesight-agent-provider-changed', handleChanged);
    return () => {
      window.removeEventListener('wesight-agent-provider-changed', handleChanged);
    };
  }, [loadProviders]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!appType) return;
    const handleOpenModelSelector = () => {
      setIsOpen(true);
    };
    window.addEventListener('cowork:open-model-selector', handleOpenModelSelector);
    return () => {
      window.removeEventListener('cowork:open-model-selector', handleOpenModelSelector);
    };
  }, [appType]);

  if (!appType) {
    return <ModelSelector dropdownDirection={dropdownDirection} />;
  }

  const providers = providerResult?.providers ?? [];
  const currentProvider = providers.find((provider) => provider.id === providerResult?.currentProviderId)
    ?? providers.find((provider) => provider.isCurrent)
    ?? providers[0]
    ?? null;
  const dropdownPositionClass = dropdownDirection === 'up'
    ? 'bottom-full mb-1'
    : 'top-full mt-1';

  const handleProviderSelect = async (provider: ExternalAgentProvider) => {
    if (!appType || switchingProviderId || provider.id === currentProvider?.id) {
      setIsOpen(false);
      return;
    }
    setSwitchingProviderId(provider.id);
    try {
      const result = await coworkService.setCurrentAgentProvider(appType, provider.id);
      if (result.success) {
        setProviderResult(result);
        window.dispatchEvent(new CustomEvent('wesight-agent-provider-changed', {
          detail: { appType },
        }));
        setIsOpen(false);
      }
    } finally {
      setSwitchingProviderId(null);
    }
  };

  if (providers.length === 0) {
    return (
      <div className="px-3 py-1.5 rounded-xl bg-surface text-secondary text-sm">
        {isLoading ? i18nService.t('loading') : i18nService.t('coworkAgentLocalModelEmpty')}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative cursor-pointer">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || Boolean(switchingProviderId)}
        className={`flex max-w-[260px] items-center gap-2 rounded-xl px-3 py-1.5 text-foreground transition-colors hover:bg-surface-raised disabled:cursor-wait disabled:opacity-70 ${isOpen ? 'bg-surface-raised' : ''}`}
        title={getProviderModelLabel(currentProvider)}
      >
        <span className="truncate text-sm font-medium">
          {getProviderModelLabel(currentProvider)}
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-secondary" />
      </button>

      {isOpen && (
        <div className={`absolute ${dropdownPositionClass} right-0 z-50 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-popover popover-enter`}>
          <div className="max-h-72 overflow-y-auto py-1">
            {providers.map((provider) => {
              const selected = provider.id === currentProvider?.id;
              const switching = provider.id === switchingProviderId;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => void handleProviderSelect(provider)}
                  disabled={Boolean(switchingProviderId)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-raised disabled:cursor-wait disabled:opacity-70 ${selected ? 'bg-surface-raised/70' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">
                      {provider.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-secondary">
                      {provider.summary.model || provider.summary.baseUrl || i18nService.t('coworkAgentLocalModelUnknown')}
                    </span>
                  </span>
                  {switching ? (
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                  ) : (
                    selected && <CheckIcon className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoworkModelSelector;
