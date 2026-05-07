import {
  CheckIcon,
  ChevronDownIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { CoworkAgentEngine } from '@shared/cowork/constants';
import React from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type {
  CoworkAgentEngine as CoworkAgentEngineType,
  ExternalAgentEnvironmentSnapshot,
} from '../../types/cowork';

interface CoworkEngineSelectorProps {
  dropdownDirection?: 'up' | 'down';
}

const ENGINE_OPTIONS: Array<{
  engine: CoworkAgentEngineType;
  labelKey: string;
  hintKey: string;
}> = [
  {
    engine: CoworkAgentEngine.OpenClaw,
    labelKey: 'coworkAgentEngineOpenClaw',
    hintKey: 'coworkAgentEngineOpenClawHint',
  },
  {
    engine: CoworkAgentEngine.Hermes,
    labelKey: 'coworkAgentEngineHermes',
    hintKey: 'coworkAgentEngineHermesHint',
  },
  {
    engine: CoworkAgentEngine.YdCowork,
    labelKey: 'coworkAgentEngineClaudeLegacy',
    hintKey: 'coworkAgentEngineClaudeLegacyHint',
  },
  {
    engine: CoworkAgentEngine.ClaudeCode,
    labelKey: 'coworkAgentEngineClaudeCode',
    hintKey: 'coworkAgentEngineClaudeCodeHint',
  },
  {
    engine: CoworkAgentEngine.Codex,
    labelKey: 'coworkAgentEngineCodex',
    hintKey: 'coworkAgentEngineCodexHint',
  },
];

const isCliEngine = (engine: CoworkAgentEngineType): boolean => {
  return engine === CoworkAgentEngine.ClaudeCode || engine === CoworkAgentEngine.Codex;
};

const CoworkEngineSelector: React.FC<CoworkEngineSelectorProps> = ({
  dropdownDirection = 'down',
}) => {
  const selectedEngine = useSelector((state: RootState) => state.cowork.config.agentEngine);
  const [isOpen, setIsOpen] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [pendingEngine, setPendingEngine] = React.useState<CoworkAgentEngineType | null>(null);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  const [snapshot, setSnapshot] = React.useState<ExternalAgentEnvironmentSnapshot | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = ENGINE_OPTIONS.find((option) => option.engine === selectedEngine)
    ?? ENGINE_OPTIONS[1];

  React.useEffect(() => {
    let mounted = true;
    coworkService.getAgentEngineSnapshot()
      .then((nextSnapshot) => {
        if (mounted) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch(() => {
        if (mounted) {
          setSnapshot(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  const dropdownPositionClass = dropdownDirection === 'up'
    ? 'bottom-full mb-1'
    : 'top-full mt-1';

  const selectEngine = async (engine: CoworkAgentEngineType) => {
    if (engine === selectedEngine || isUpdating) {
      setIsOpen(false);
      return;
    }
    setIsUpdating(true);
    setPendingEngine(engine);
    setSwitchError(null);
    try {
      const ok = await coworkService.updateConfig({ agentEngine: engine });
      if (ok) {
        const nextSnapshot = await coworkService.getAgentEngineSnapshot();
        setSnapshot(nextSnapshot);
        setIsOpen(false);
      } else {
        setSwitchError(i18nService.t('coworkAgentEngineSwitchFailed'));
      }
    } finally {
      setIsUpdating(false);
      setPendingEngine(null);
    }
  };

  const getCliStatus = (engine: CoworkAgentEngineType) => {
    return snapshot?.engines.find((item) => item.engine === engine) ?? null;
  };

  const renderCliStatus = (engine: CoworkAgentEngineType) => {
    const status = getCliStatus(engine);
    if (!isCliEngine(engine) || !status) return null;
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-secondary">
        <span className={`h-1.5 w-1.5 rounded-full ${status.found ? 'bg-green-500' : 'bg-amber-500'}`} />
        <span className="truncate">
          {i18nService.t(status.found ? 'coworkAgentEngineCliInstalled' : 'coworkAgentEngineCliMissing')}
          {status.version ? ` · ${status.version}` : ''}
        </span>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-foreground transition-colors hover:bg-surface-raised ${isOpen ? 'bg-surface-raised' : ''}`}
        title={i18nService.t('coworkAgentEngineSelect')}
        aria-label={i18nService.t('coworkAgentEngineSelect')}
        disabled={isUpdating}
      >
        <CpuChipIcon className="h-4 w-4 text-secondary" />
        <span className="max-w-[120px] truncate font-medium">
          {i18nService.t(selectedOption.labelKey)}
        </span>
        <ChevronDownIcon className="h-4 w-4 text-secondary" />
      </button>

      {isOpen && (
        <div className={`absolute right-0 ${dropdownPositionClass} z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-popover popover-enter`}>
          {isUpdating && (
            <div className="border-b border-border px-3.5 py-3">
              <div className="flex items-center justify-between gap-3 text-xs text-secondary">
                <span>{i18nService.t('coworkAgentEngineSwitching')}</span>
                <span className="truncate text-[11px]">
                  {pendingEngine
                    ? i18nService.t(ENGINE_OPTIONS.find((option) => option.engine === pendingEngine)?.labelKey || selectedOption.labelKey)
                    : ''}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
          {switchError && (
            <div className="border-b border-border px-3.5 py-2 text-xs text-red-600 dark:text-red-400">
              {switchError}
            </div>
          )}
          <div className="max-h-[360px] overflow-y-auto py-1">
            {ENGINE_OPTIONS.map((option) => {
              const active = option.engine === selectedEngine;
              const pending = option.engine === pendingEngine;
              return (
                <button
                  key={option.engine}
                  type="button"
                  onClick={() => void selectEngine(option.engine)}
                  disabled={isUpdating}
                  className={`w-full px-3.5 py-3 text-left transition-colors hover:bg-surface-raised disabled:cursor-wait disabled:opacity-60 ${active ? 'bg-surface-raised/70' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {i18nService.t(option.labelKey)}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-secondary">
                        {i18nService.t(option.hintKey)}
                      </div>
                      {renderCliStatus(option.engine)}
                    </div>
                    {pending ? (
                      <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                    ) : (
                      active && <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoworkEngineSelector;
