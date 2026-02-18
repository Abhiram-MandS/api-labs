'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Globe, 
  Plus, 
  Trash2, 
  Activity, 
  Settings, 
  X, 
  CheckCircle2,
  Server,
  EyeOff,
  Search,
  Filter,
  ToggleLeft,
  ToggleRight,
  Regex,
  Pencil,
  Download,
  Upload,
  FileText,
  FileUp,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Power,
  PowerOff,
  Copy,
  CheckSquare,
  Square,
  MinusSquare,
  Moon,
  Sun,
  Sparkles
} from 'lucide-react';
import io from 'socket.io-client';
import { parseSwaggerSpec, type SwaggerParseResult } from './utils/swagger-parser';
import { mocksToPostmanCollection } from './utils/postman-export';

let _idCounter = 0;
const uniqueId = () => {
  _idCounter++;
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 12), 16) + _idCounter
    : Date.now() * 1000 + _idCounter;
};

// Ensure every item has a unique numeric id
const dedup = <T extends { id: number }>(items: T[]): T[] => {
  const seen = new Set<number>();
  return items.map(item => {
    if (seen.has(item.id)) {
      return { ...item, id: uniqueId() };
    }
    seen.add(item.id);
    return item;
  });
};

// Store the original fetch outside the component
let originalFetch: typeof fetch;
if (typeof window !== 'undefined') {
  originalFetch = window.fetch;
}

interface LogEntry {
  id: string;
  url: string;
  method: string;
  status: number | string;
  duration: number;
  type: 'Mock' | 'Network' | 'Server';
  body: unknown;
  timestamp: string;
  isManaged: boolean;
  source?: 'browser' | 'proxy';
}

interface MockRule {
  id: number;
  pattern: string;
  method: string;
  status: number;
  body: string;
  aiBody?: string;
  aiStatus?: 'idle' | 'generating' | 'done' | 'error';
  aiError?: string;
  enabled: boolean;
}

interface UrlFilter {
  id: number;
  pattern: string;
  isRegex: boolean;
  enabled: boolean;
}

interface ContextMenu {
  x: number;
  y: number;
  url: string;
  method: string;
  status?: number | string;
  body?: unknown;
}

export default function Home() {
  // --- localStorage helpers ---
  const loadFromStorage = <T,>(key: string, fallback: T): T => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch {
      return fallback;
    }
  };

  // Initialise with server-safe defaults to avoid hydration mismatch.
  // localStorage values are loaded in a useEffect after mount.
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mocks, setMocks] = useState<MockRule[]>([]);
  const [domains, setDomains] = useState<string[]>(['jsonplaceholder.typicode.com', 'api.github.com']);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [isMockModalOpen, setIsMockModalOpen] = useState(false);
  const [isDomainModalOpen, setIsDomainModalOpen] = useState(false);
  const [proxyConnected, setProxyConnected] = useState(false);
  const [urlFilters, setUrlFilters] = useState<UrlFilter[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [newFilter, setNewFilter] = useState({ pattern: '', isRegex: false });
  const [editingMockId, setEditingMockId] = useState<number | null>(null);
  const [isMockPanelOpen, setIsMockPanelOpen] = useState(false);
  const [mockSearch, setMockSearch] = useState('');
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [mockContextMenu, setMockContextMenu] = useState<{ x: number; y: number; mock: MockRule } | null>(null);
  const [mockControllerFilter, setMockControllerFilter] = useState<string>('all');
  const [selectedMockIds, setSelectedMockIds] = useState<Set<number>>(new Set());
  const [isSwaggerModalOpen, setIsSwaggerModalOpen] = useState(false);
  const [swaggerInput, setSwaggerInput] = useState('');
  const [swaggerResult, setSwaggerResult] = useState<SwaggerParseResult | null>(null);
  const [swaggerSelectedIds, setSwaggerSelectedIds] = useState<Set<number>>(new Set());
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [githubPat, setGithubPat] = useState('');
  const [aiModel, setAiModel] = useState<'gpt-4o-mini' | 'gpt-4o'>('gpt-4o-mini');
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const skipNextSync = useRef(false);
  const hydratedRef = useRef(false);
  
  // Form States
  const [newMock, setNewMock] = useState({ 
    pattern: '', 
    method: 'GET', 
    status: 200, 
    body: '{\n  "status": "success"\n}' 
  });
  const [newDomain, setNewDomain] = useState('');

  // --- Hydrate state from localStorage after mount ---
  useEffect(() => {
    setMocks(dedup(loadFromStorage('api-labs:mocks', [])));
    setDomains(loadFromStorage('api-labs:domains', ['jsonplaceholder.typicode.com', 'api.github.com']));
    setUrlFilters(dedup(loadFromStorage('api-labs:urlFilters', [])));
    setIsDarkMode(loadFromStorage('api-labs:darkMode', false));
    setIsAIEnabled(loadFromStorage('api-labs:aiEnabled', false));
    setGithubPat(loadFromStorage('api-labs:githubPat', ''));
    setAiModel(loadFromStorage('api-labs:aiModel', 'gpt-4o-mini'));
    hydratedRef.current = true;
  }, []);

  // --- Persist to localStorage (skip the initial hydration write-back) ---
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:mocks', JSON.stringify(mocks)); }, [mocks]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:domains', JSON.stringify(domains)); }, [domains]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:urlFilters', JSON.stringify(urlFilters)); }, [urlFilters]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:darkMode', JSON.stringify(isDarkMode)); }, [isDarkMode]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:aiEnabled', JSON.stringify(isAIEnabled)); }, [isAIEnabled]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:githubPat', JSON.stringify(githubPat)); }, [githubPat]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem('api-labs:aiModel', JSON.stringify(aiModel)); }, [aiModel]);

  // --- Dark mode class management ---
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // --- WebSocket connection to proxy server ---
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const PROXY_URL = 'http://localhost:8888';
    const socket = io(PROXY_URL, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('✅ Connected to proxy server');
      setProxyConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from proxy server');
      setProxyConnected(false);
    });

    socket.on('proxy-log', (logEntry: LogEntry) => {
      console.log('📥 Received proxy log:', logEntry);
      setLogs(prev => [{ ...logEntry, source: 'proxy' }, ...prev]);
    });

    // Receive mock rules synced from server (e.g. on reconnect or from another client)
    socket.on('mock-rules-sync', (rules: MockRule[]) => {
      console.log('🎭 Mock rules synced from server:', rules.length);
      skipNextSync.current = true;
      setMocks(dedup(rules));
    });

    // Store socket ref for sending updates
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // --- Sync mock rules to proxy server ---
  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    if (socketRef.current?.connected) {
      socketRef.current.emit('mock-rules-update', mocks);
    }
  }, [mocks]);

  // --- Sync AI settings to proxy server ---
  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('settings-update', { isAIEnabled });
    }
  }, [isAIEnabled]);

  // --- Browser fetch interception ---
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Override fetch
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [resource, config] = args;
      const urlString = typeof resource === 'string' ? resource : ('url' in resource ? resource.url : resource.toString());
      const method = config?.method || 'GET';
      const startTime = Date.now();
      const logId = Math.random().toString(36).substr(2, 9);

      // Check if domain is managed
      const url = new URL(urlString, window.location.origin);
      const isManaged = domains.some(d => url.hostname.includes(d) || urlString.includes(d));

      // Check for mock match
      const mockRule = mocks.find(m => 
        urlString.includes(m.pattern) && 
        m.method === method && 
        m.enabled
      );

      let response;
      let isMocked = false;

      if (mockRule) {
        isMocked = true;
        await new Promise(r => setTimeout(r, 300)); // Simulate slight delay
        const effectiveBody = (isAIEnabled && mockRule.aiBody) ? mockRule.aiBody : mockRule.body;
        response = new Response(effectiveBody, {
          status: mockRule.status,
          headers: { 'Content-Type': 'application/json', 'X-Mock-By': 'HTTPIntercept' }
        });
      } else {
        try {
          response = await originalFetch(...args);
        } catch (err: unknown) {
          const errorLog: LogEntry = {
            id: logId,
            url: urlString,
            method,
            status: 'FAIL',
            duration: Date.now() - startTime,
            type: 'Network',
            body: { error: err instanceof Error ? err.message : String(err) },
            timestamp: new Date().toLocaleTimeString(),
            isManaged,
            source: 'browser' as const
          };
          setLogs(prev => [errorLog, ...prev]);
          throw err;
        }
      }

      const cloned = response.clone();
      const duration = Date.now() - startTime;
      
      let data;
      try {
        data = await cloned.json();
      } catch {
        data = "Non-JSON or Empty Response";
      }

      const newLog: LogEntry = {
        id: logId,
        url: urlString,
        method,
        status: response.status,
        duration,
        type: isMocked ? 'Mock' : 'Network',
        body: data,
        timestamp: new Date().toLocaleTimeString(),
        isManaged,
        source: 'browser' as const
      };

      setLogs(prev => [newLog, ...prev]);
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [mocks, domains, isAIEnabled]);

  // --- Handlers ---
  const generateAIBody = useCallback(async (mockId: number, mockData?: MockRule) => {
    const mock = mockData || mocks.find(m => m.id === mockId);
    if (!mock) return;

    setMocks(prev => prev.map(m =>
      m.id === mockId ? { ...m, aiStatus: 'generating' as const, aiError: undefined } : m
    ));

    try {
      const response = await originalFetch('http://localhost:8888/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(githubPat ? { 'X-GitHub-Token': githubPat } : {}),
        },
        body: JSON.stringify({
          pattern: mock.pattern,
          method: mock.method,
          status: mock.status,
          body: mock.body,
          model: aiModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      setMocks(prev => prev.map(m =>
        m.id === mockId ? { ...m, aiBody: data.aiBody, aiStatus: 'done' as const, aiError: undefined } : m
      ));
    } catch (err) {
      setMocks(prev => prev.map(m =>
        m.id === mockId
          ? { ...m, aiStatus: 'error' as const, aiError: err instanceof Error ? err.message : String(err) }
          : m
      ));
    }
  }, [mocks, githubPat, aiModel]);

  const handleAddMock = () => {
    if (!newMock.pattern) return;
    let savedMockId: number;
    if (editingMockId !== null) {
      savedMockId = editingMockId;
      setMocks(mocks.map(m => m.id === editingMockId ? { ...m, pattern: newMock.pattern, method: newMock.method, status: newMock.status, body: newMock.body, aiBody: undefined, aiStatus: 'idle' as const } : m));
      setEditingMockId(null);
    } else {
      savedMockId = uniqueId();
      setMocks([...mocks, { ...newMock, id: savedMockId, enabled: true, aiStatus: 'idle' as const }]);
    }
    setIsMockModalOpen(false);
    setNewMock({ pattern: '', method: 'GET', status: 200, body: '{\n  "status": "success"\n}' });

    // Trigger AI generation if AI is enabled
    if (isAIEnabled) {
      const mockData: MockRule = { id: savedMockId, pattern: newMock.pattern, method: newMock.method, status: newMock.status, body: newMock.body, enabled: true };
      setTimeout(() => generateAIBody(savedMockId, mockData), 100);
    }
  };

  const handleEditMock = (mock: MockRule) => {
    setEditingMockId(mock.id);
    setNewMock({ pattern: mock.pattern, method: mock.method, status: mock.status, body: mock.body });
    setIsMockModalOpen(true);
  };

  const handleAddDomain = () => {
    if (!newDomain || domains.includes(newDomain)) return;
    setDomains([...domains, newDomain]);
    setNewDomain('');
    setIsDomainModalOpen(false);
  };

  const removeDomain = (domain: string) => {
    setDomains(domains.filter(d => d !== domain));
  };

  const toggleMock = (id: number) => {
    setMocks(mocks.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));
  };

  const deleteMock = (id: number) => {
    setMocks(mocks.filter(m => m.id !== id));
    setSelectedMockIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  // --- Controller name extraction ---
  const getControllerName = (pattern: string): string => {
    // Strip protocol/host if present
    let path = pattern;
    try {
      if (pattern.startsWith('http')) path = new URL(pattern).pathname;
    } catch { /* not a full URL */ }
    // Split by / and find the first meaningful segment (skip api, v1, v2 etc.)
    const segments = path.split('/').filter(Boolean);
    const skipPrefixes = /^(api|v\d+|v\d+\.\d+)$/i;
    for (const seg of segments) {
      if (!skipPrefixes.test(seg)) return seg.toLowerCase();
    }
    return segments[0]?.toLowerCase() || 'other';
  };

  // Unique controller names from all mocks
  const controllerNames = useMemo(() => {
    const names = new Set(mocks.map(m => getControllerName(m.pattern)));
    return Array.from(names).sort();
  }, [mocks]);

  // Filtered mocks (search + controller)
  const filteredMocks = useMemo(() => {
    return mocks.filter(m => {
      // Controller filter
      if (mockControllerFilter !== 'all' && getControllerName(m.pattern) !== mockControllerFilter) return false;
      // Text search
      if (mockSearch) {
        const q = mockSearch.toLowerCase();
        if (!m.pattern.toLowerCase().includes(q) && !m.method.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [mocks, mockControllerFilter, mockSearch]);

  // Selection helpers
  const toggleMockSelection = (id: number) => {
    setSelectedMockIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredMocks.map(m => m.id);
    const allSelected = visibleIds.every(id => selectedMockIds.has(id));
    if (allSelected) {
      setSelectedMockIds(prev => {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedMockIds(prev => new Set([...prev, ...visibleIds]));
    }
  };

  const bulkEnableSelected = (enabled: boolean) => {
    setMocks(mocks.map(m => selectedMockIds.has(m.id) ? { ...m, enabled } : m));
  };

  const bulkDeleteSelected = () => {
    if (!confirm(`Delete ${selectedMockIds.size} selected mock rule(s)?`)) return;
    setMocks(mocks.filter(m => !selectedMockIds.has(m.id)));
    setSelectedMockIds(new Set());
  };

  // --- Import / Export Mock Rules ---
  const exportMocks = () => {
    const toExport = selectedMockIds.size > 0 ? mocks.filter(m => selectedMockIds.has(m.id)) : filteredMocks;
    const data = JSON.stringify(toExport, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-labs-mocks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsPostman = () => {
    const toExport = selectedMockIds.size > 0 ? mocks.filter(m => selectedMockIds.has(m.id)) : filteredMocks;
    const data = mocksToPostmanCollection(toExport, undefined, isAIEnabled);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-labs-postman-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importMocks = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target?.result as string);
          if (!Array.isArray(imported)) throw new Error('Invalid format');
          const validated: MockRule[] = imported.map((rule: Record<string, unknown>) => ({
            id: typeof rule.id === 'number' ? rule.id : uniqueId(),
            pattern: String(rule.pattern ?? ''),
            method: String(rule.method ?? 'GET'),
            status: Number(rule.status ?? 200),
            body: typeof rule.body === 'string' ? rule.body : JSON.stringify(rule.body ?? {}, null, 2),
            enabled: rule.enabled !== false,
          }));
          setMocks(prev => [...prev, ...validated]);
        } catch {
          alert('Invalid mock rules file. Expected a JSON array of mock rules.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // --- Swagger Import ---
  const handleSwaggerParse = () => {
    const result = parseSwaggerSpec(swaggerInput);
    setSwaggerResult(result);
    if (!result.error) {
      setSwaggerSelectedIds(new Set(result.rules.map(r => r.id)));
    }
  };

  const handleSwaggerFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setSwaggerInput(text);
      const result = parseSwaggerSpec(text);
      setSwaggerResult(result);
      if (!result.error) {
        setSwaggerSelectedIds(new Set(result.rules.map(r => r.id)));
      }
    };
    reader.readAsText(file);
  };

  const handleSwaggerImport = () => {
    if (!swaggerResult || swaggerResult.error) return;
    const selected = swaggerResult.rules.filter(r => swaggerSelectedIds.has(r.id));
    // Re-assign unique IDs to avoid collisions
    const withIds = selected.map(r => ({ ...r, id: uniqueId(), aiStatus: 'idle' as const }));
    setMocks(prev => [...prev, ...withIds]);
    setIsSwaggerModalOpen(false);
    setSwaggerInput('');
    setSwaggerResult(null);
    setSwaggerSelectedIds(new Set());

    // Trigger AI generation for all imported rules if AI is enabled
    if (isAIEnabled) {
      setTimeout(() => {
        withIds.forEach(r => generateAIBody(r.id, r as MockRule));
      }, 200);
    }
  };

  const toggleSwaggerRule = (id: number) => {
    setSwaggerSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllSwaggerRules = () => {
    if (!swaggerResult) return;
    if (swaggerSelectedIds.size === swaggerResult.rules.length) {
      setSwaggerSelectedIds(new Set());
    } else {
      setSwaggerSelectedIds(new Set(swaggerResult.rules.map(r => r.id)));
    }
  };

  // --- URL Filter Handlers ---
  const addUrlFilter = (pattern: string, isRegex = false) => {
    if (!pattern) return;
    const exists = urlFilters.some(f => f.pattern === pattern);
    if (exists) return;
    setUrlFilters(prev => [...prev, { id: uniqueId(), pattern, isRegex, enabled: true }]);
  };

  const removeUrlFilter = (id: number) => {
    setUrlFilters(prev => prev.filter(f => f.id !== id));
  };

  const toggleUrlFilter = (id: number) => {
    setUrlFilters(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };

  const handleAddFilter = () => {
    if (!newFilter.pattern) return;
    addUrlFilter(newFilter.pattern, newFilter.isRegex);
    setNewFilter({ pattern: '', isRegex: false });
    setIsFilterModalOpen(false);
  };

  const isUrlFiltered = useCallback((url: string): boolean => {
    return urlFilters.some(f => {
      if (!f.enabled) return false;
      if (f.isRegex) {
        try {
          return new RegExp(f.pattern).test(url);
        } catch {
          return false;
        }
      }
      return url.includes(f.pattern);
    });
  }, [urlFilters]);

  const filteredLogs = useMemo(() => logs.filter(l => !isUrlFiltered(l.url)), [logs, isUrlFiltered]);

  const selectedLog = useMemo(() => logs.find(l => l.id === selectedLogId), [selectedLogId, logs]);

  // Close context menus and dropdowns on click anywhere
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setMockContextMenu(null);
      setExportDropdownOpen(false);
    };
    if (contextMenu || mockContextMenu || exportDropdownOpen) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu, mockContextMenu, exportDropdownOpen]);

  const handleRowContextMenu = (e: React.MouseEvent, log: LogEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, url: log.url, method: log.method, status: log.status, body: log.body });
  };

  const testFetch = () => {
    const targets = [
      'https://jsonplaceholder.typicode.com/todos/1',
      'https://api.github.com/users/octocat',
      '/api/local-mock-test'
    ];
    fetch(targets[Math.floor(Math.random() * targets.length)]);
  };

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      
      {/* Sidebar */}
      <aside className="w-72 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-zinc-100 dark:border-zinc-800">
          <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mr-2" />
          <span className="font-bold tracking-tight text-zinc-800 dark:text-zinc-100">API Labs</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-8">
          {/* Domains Section */}
          <section>
            <div className="flex items-center justify-between mb-3 px-2">
              <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center">
                <Globe className="w-3 h-3 mr-1" /> Domains
              </h2>
              <button onClick={() => setIsDomainModalOpen(true)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {domains.map(d => (
                <div key={d} className="flex items-center justify-between px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md group">
                  <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">{d}</span>
                  <button onClick={() => removeDomain(d)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Mocks Section — compact summary */}
          <section>
            <div className="flex items-center justify-between mb-3 px-2">
              <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center">
                <Settings className="w-3 h-3 mr-1" /> Mock Rules
              </h2>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setIsMockModalOpen(true)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400" title="Add rule">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Summary card */}
            <button
              onClick={() => setIsMockPanelOpen(true)}
              className="w-full text-left p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{mocks.length} rule{mocks.length !== 1 ? 's' : ''}</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{mocks.filter(m => m.enabled).length} active</span>
                {mocks.filter(m => !m.enabled).length > 0 && (
                  <span className="text-zinc-400">{mocks.filter(m => !m.enabled).length} paused</span>
                )}
              </div>
              {proxyConnected && mocks.length > 0 && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-indigo-500 dark:text-indigo-400">
                  <Server className="w-3 h-3" /> Synced
                </div>
              )}
            </button>
            {mocks.length === 0 && <p className="text-[11px] text-zinc-400 text-center py-2 italic">No rules defined</p>}
          </section>

          {/* URL Filters Section */}
          <section>
            <div className="flex items-center justify-between mb-3 px-2">
              <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center">
                <EyeOff className="w-3 h-3 mr-1" /> URL Filters
              </h2>
              <button onClick={() => setIsFilterModalOpen(true)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {urlFilters.length > 0 && (
              <div className="mb-2 px-1">
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={filterSearch}
                    onChange={e => setFilterSearch(e.target.value)}
                    placeholder="Search filters..."
                    className="w-full pl-7 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md text-[11px] outline-none focus:ring-1 focus:ring-indigo-500/30 focus:border-indigo-400"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {urlFilters.length === 0 && (
                <p className="text-[11px] text-zinc-400 text-center py-3 italic">Right-click a row to hide</p>
              )}
              {urlFilters
                .filter(f => !filterSearch || f.pattern.toLowerCase().includes(filterSearch.toLowerCase()))
                .map(f => (
                  <div key={f.id} className={`flex items-center justify-between px-3 py-2 text-xs border rounded-md group transition-all ${
                    f.enabled ? 'bg-red-50/50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40' : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 opacity-50'
                  }`}>
                    <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                      {f.isRegex && <span title="Regex"><Regex className="w-3 h-3 text-amber-500 shrink-0" /></span>}
                      <span className="truncate font-mono text-zinc-600 dark:text-zinc-300" title={f.pattern}>{f.pattern}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button onClick={() => toggleUrlFilter(f.id)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title={f.enabled ? 'Disable' : 'Enable'}>
                        {f.enabled ? <ToggleRight className="w-3.5 h-3.5 text-red-500" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => removeUrlFilter(f.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              }
            </div>
          </section>

          {/* Proxy Status Section */}
          <section className="mt-auto pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="px-2">
              <div className="flex items-center gap-2 text-xs">
                <Server className="w-3 h-3" />
                <span className="text-zinc-400">Proxy Server</span>
              </div>
              <div className={`mt-2 px-3 py-2 rounded-md text-xs font-medium ${
                proxyConnected 
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' 
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
              }`}>
                {proxyConnected ? '✓ Connected' : '○ Disconnected'}
              </div>
            </div>
          </section>
        </div>

        {/* Settings Button */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </aside>

      {/* Mock Rules Panel */}
      {isMockPanelOpen && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-zinc-900/30 dark:bg-black/50 backdrop-blur-sm" onClick={() => setIsMockPanelOpen(false)} />

          {/* Panel */}
          <div className="relative z-10 ml-auto w-full max-w-6xl bg-white dark:bg-zinc-900 shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Mock Rules</h2>
                <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">{mocks.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsMockPanelOpen(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Toolbar */}
            <div className="px-6 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3 shrink-0 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  value={mockSearch}
                  onChange={e => setMockSearch(e.target.value)}
                  placeholder="Search rules by pattern or method..."
                  className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                />
              </div>
              <div className="relative">
                <select
                  value={mockControllerFilter}
                  onChange={e => setMockControllerFilter(e.target.value)}
                  className="appearance-none pl-7 pr-8 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all cursor-pointer"
                >
                  <option value="all">All Controllers</option>
                  {controllerNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <ChevronDown className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setExportDropdownOpen(!exportDropdownOpen); }}
                    className="px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg flex items-center gap-1.5 transition-colors"
                    title="Export"
                  >
                    <Download className="w-3.5 h-3.5" /> Export <ChevronDown className="w-3 h-3" />
                  </button>
                  {exportDropdownOpen && (
                    <div className="absolute right-0 mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl py-1.5 min-w-[200px] z-50 animate-in fade-in">
                      <button
                        onClick={() => { exportMocks(); setExportDropdownOpen(false); }}
                        className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
                      >
                        <Download className="w-3.5 h-3.5 text-zinc-400" />
                        Export as JSON
                      </button>
                      <button
                        onClick={() => { exportAsPostman(); setExportDropdownOpen(false); }}
                        className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
                      >
                        <FileText className="w-3.5 h-3.5 text-orange-500" />
                        Export as Postman Collection
                      </button>
                    </div>
                  )}
                </div>
                <button onClick={importMocks} className="px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg flex items-center gap-1.5 transition-colors" title="Import JSON">
                  <Upload className="w-3.5 h-3.5" /> Import
                </button>
                <button onClick={() => { setSwaggerInput(''); setSwaggerResult(null); setSwaggerSelectedIds(new Set()); setIsSwaggerModalOpen(true); }} className="px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg flex items-center gap-1.5 transition-colors" title="Import from Swagger">
                  <FileText className="w-3.5 h-3.5" /> Swagger
                </button>
                <button onClick={() => setIsMockModalOpen(true)} className="px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> Add Rule
                </button>
              </div>
            </div>

            {/* Bulk actions */}
            {mocks.length > 0 && (
              <div className="px-6 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3 text-[11px] shrink-0">
                {selectedMockIds.size > 0 ? (
                  <>
                    <span className="text-indigo-600 font-semibold">{selectedMockIds.size} selected</span>
                    <div className="h-3 w-px bg-zinc-200" />
                    <button
                      onClick={() => bulkEnableSelected(true)}
                      className="text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1"
                    >
                      <Power className="w-3 h-3" /> Enable
                    </button>
                    <button
                      onClick={() => bulkEnableSelected(false)}
                      className="text-zinc-500 hover:text-zinc-700 font-medium flex items-center gap-1"
                    >
                      <PowerOff className="w-3 h-3" /> Disable
                    </button>
                    <div className="h-3 w-px bg-zinc-200" />
                    <button
                      onClick={bulkDeleteSelected}
                      className="text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                    {isAIEnabled && (
                      <>
                        <div className="h-3 w-px bg-zinc-200" />
                        <button
                          onClick={() => mocks.filter(m => selectedMockIds.has(m.id)).forEach(m => generateAIBody(m.id))}
                          className="text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" /> Generate AI
                        </button>
                      </>
                    )}
                    <div className="h-3 w-px bg-zinc-200" />
                    <button
                      onClick={() => setSelectedMockIds(new Set())}
                      className="text-zinc-400 hover:text-zinc-600 font-medium"
                    >
                      Clear selection
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setMocks(mocks.map(m => ({ ...m, enabled: true })))}
                      className="text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1"
                    >
                      <Power className="w-3 h-3" /> Enable All
                    </button>
                    <button
                      onClick={() => setMocks(mocks.map(m => ({ ...m, enabled: false })))}
                      className="text-zinc-500 hover:text-zinc-700 font-medium flex items-center gap-1"
                    >
                      <PowerOff className="w-3 h-3" /> Disable All
                    </button>
                    <div className="h-3 w-px bg-zinc-200" />
                    <button
                      onClick={() => { if (confirm(`Delete all ${mocks.length} mock rules?`)) setMocks([]); }}
                      className="text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete All
                    </button>
                    {isAIEnabled && (
                      <>
                        <div className="h-3 w-px bg-zinc-200" />
                        <button
                          onClick={() => filteredMocks.forEach(m => generateAIBody(m.id))}
                          className="text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" /> Generate All AI
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Rules list */}
            <div className="flex-1 overflow-y-auto">
              {mocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-400">
                  <Settings className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No mock rules defined</p>
                  <p className="text-xs mt-1">Add a rule or import from Swagger</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-zinc-50/95 dark:bg-zinc-800/95 backdrop-blur z-10">
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="pl-6 pr-1 py-2.5 w-10">
                        <button onClick={toggleSelectAllVisible} title={filteredMocks.length > 0 && filteredMocks.every(m => selectedMockIds.has(m.id)) ? 'Deselect all' : 'Select all'}>
                          {filteredMocks.length > 0 && filteredMocks.every(m => selectedMockIds.has(m.id))
                            ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                            : filteredMocks.some(m => selectedMockIds.has(m.id))
                              ? <MinusSquare className="w-4 h-4 text-indigo-400" />
                              : <Square className="w-4 h-4 text-zinc-300" />
                          }
                        </button>
                      </th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-14">Status</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-20">Method</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Pattern</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-24 text-center">Controller</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-16 text-center">Code</th>
                      {isAIEnabled && <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-14 text-center">AI</th>}
                      <th className="px-4 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-28 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMocks
                      .map(m => (
                        <tr
                          key={m.id}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMockContextMenu({ x: e.clientX, y: e.clientY, mock: m });
                          }}
                          className={`border-b border-zinc-100 dark:border-zinc-800 transition-colors group ${
                            selectedMockIds.has(m.id) ? 'bg-indigo-50/40 dark:bg-indigo-950/30' : m.enabled ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : 'opacity-50 bg-zinc-50/50 dark:bg-zinc-800/30'
                          }`}
                        >
                          <td className="pl-6 pr-1 py-3">
                            <button onClick={() => toggleMockSelection(m.id)} title={selectedMockIds.has(m.id) ? 'Deselect' : 'Select'}>
                              {selectedMockIds.has(m.id)
                                ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                                : <Square className="w-4 h-4 text-zinc-300 group-hover:text-zinc-400" />
                              }
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => toggleMock(m.id)} title={m.enabled ? 'Disable' : 'Enable'}>
                              {m.enabled
                                ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                                : <ToggleLeft className="w-5 h-5 text-zinc-300" />
                              }
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
                              m.method === 'GET' ? 'bg-emerald-100 text-emerald-700'
                              : m.method === 'POST' ? 'bg-blue-100 text-blue-700'
                              : m.method === 'PUT' ? 'bg-amber-100 text-amber-700'
                              : m.method === 'DELETE' ? 'bg-red-100 text-red-700'
                              : 'bg-zinc-100 text-zinc-500'
                            }`}>{m.method}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate block max-w-md" title={m.pattern}>{m.pattern}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 capitalize">{getControllerName(m.pattern)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-[11px] font-mono text-zinc-500">{m.status}</span>
                          </td>
                          {isAIEnabled && (
                            <td className="px-4 py-3 text-center">
                              {m.aiStatus === 'generating' ? (
                                <span className="inline-flex items-center" title="Generating AI data...">
                                  <Sparkles className="w-3.5 h-3.5 text-purple-500 animate-pulse" />
                                </span>
                              ) : m.aiStatus === 'done' && m.aiBody ? (
                                <span className="inline-flex items-center" title="AI data available">
                                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                                </span>
                              ) : m.aiStatus === 'error' ? (
                                <span className="inline-flex items-center" title={m.aiError || 'AI generation failed'}>
                                  <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                                </span>
                              ) : null}
                            </td>
                          )}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { handleEditMock(m); }} className="p-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-md text-zinc-400 hover:text-indigo-600" title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {isAIEnabled && (
                                <button
                                  onClick={() => generateAIBody(m.id)}
                                  className="p-1.5 hover:bg-purple-50 dark:hover:bg-purple-950/50 rounded-md text-zinc-400 hover:text-purple-600"
                                  title={m.aiStatus === 'generating' ? 'Generating...' : 'Regenerate AI data'}
                                  disabled={m.aiStatus === 'generating'}
                                >
                                  <Sparkles className={`w-3.5 h-3.5 ${m.aiStatus === 'generating' ? 'animate-pulse' : ''}`} />
                                </button>
                              )}
                              <button onClick={() => toggleMock(m.id)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title={m.enabled ? 'Disable' : 'Enable'}>
                                {m.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </button>
                              <button onClick={() => deleteMock(m.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-md text-zinc-400 hover:text-red-600" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {proxyConnected && mocks.length > 0 && (
              <div className="px-6 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-indigo-50/50 dark:bg-indigo-950/30 text-[11px] text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5 shrink-0">
                <Server className="w-3.5 h-3.5" /> All rules synced to proxy server
              </div>
            )}
          </div>

          {/* Mock Context Menu */}
          {mockContextMenu && (
            <div
              className="fixed z-[70] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl py-1.5 min-w-[180px] animate-in fade-in"
              style={{ left: mockContextMenu.x, top: mockContextMenu.y }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  handleEditMock(mockContextMenu.mock);
                  setMockContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
              >
                <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                Edit Rule
              </button>
              <button
                onClick={() => {
                  toggleMock(mockContextMenu.mock.id);
                  setMockContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
              >
                {mockContextMenu.mock.enabled
                  ? <><PowerOff className="w-3.5 h-3.5 text-zinc-400" /> Disable</>
                  : <><Power className="w-3.5 h-3.5 text-zinc-400" /> Enable</>
                }
              </button>
              <button
                onClick={() => {
                  const dup = { ...mockContextMenu.mock, id: uniqueId() };
                  setMocks(prev => [...prev, dup]);
                  setMockContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
              >
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                Duplicate
              </button>
              {isAIEnabled && (
                <button
                  onClick={() => {
                    generateAIBody(mockContextMenu.mock.id);
                    setMockContextMenu(null);
                  }}
                  className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  Regenerate AI Data
                </button>
              )}
              <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />
              <button
                onClick={() => {
                  deleteMock(mockContextMenu.mock.id);
                  setMockContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-red-50 dark:hover:bg-red-950/50 flex items-center gap-2 text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
        <header className="h-16 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-8 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md">
          <div className="flex items-center text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Network Activity
            <span className="ml-2 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-[10px] text-zinc-400">{filteredLogs.length}</span>
            {filteredLogs.length < logs.length && (
              <span className="ml-1 px-2 py-0.5 bg-red-50 dark:bg-red-950/40 rounded-full text-[10px] text-red-400">
                {logs.length - filteredLogs.length} hidden
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setLogs([])} className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Clear</button>
            <div className="h-4 w-[1px] bg-zinc-200 dark:bg-zinc-700"></div>
            <button 
              onClick={testFetch}
              className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-sm shadow-zinc-200 dark:shadow-zinc-800"
            >
              Test Random Request
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex">
          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-zinc-50/90 dark:bg-zinc-900/90 backdrop-blur z-10">
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-20">Source</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-24">Method</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Endpoint</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-24 text-center">Status</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-24 text-center">Type</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest w-24 text-right pr-8">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-20 text-center text-zinc-400 text-sm italic">
                      No requests captured yet. Make a fetch call to see logs.
                    </td>
                  </tr>
                )}
                {filteredLogs.map(log => (
                  <tr 
                    key={log.id} 
                    onClick={() => setSelectedLogId(log.id)}
                    onContextMenu={(e) => handleRowContextMenu(e, log)}
                    className={`border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors group ${selectedLogId === log.id ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : ''}`}
                  >
                    <td className="px-6 py-4">
                      {log.source === 'proxy' ? (
                        <span title="Server"><Server className="w-3.5 h-3.5 text-purple-600" /></span>
                      ) : (
                        <span title="Browser"><Globe className="w-3.5 h-3.5 text-blue-600" /></span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[11px] font-bold text-zinc-500">{log.method}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {log.isManaged && <Globe className="w-3 h-3 text-indigo-500 mr-2 shrink-0" />}
                      <span className="text-xs font-mono text-zinc-600 dark:text-zinc-300 truncate max-w-md">{log.url}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        log.status === 'FAIL' ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400' : 
                        typeof log.status === 'number' && log.status >= 400 ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`text-[10px] font-medium ${log.type === 'Mock' ? 'text-indigo-600' : 'text-zinc-400'}`}>
                        {log.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right pr-8">
                      <span className="text-[11px] font-mono text-zinc-400">{log.duration}ms</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inspector Panel */}
          {selectedLog && (
            <div className="w-[450px] border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col shrink-0">
              <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Inspector</h3>
                <button onClick={() => setSelectedLogId(null)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Request Details</label>
                  <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-100 dark:border-zinc-700 text-[11px] font-mono break-all leading-relaxed text-zinc-600 dark:text-zinc-300">
                    <p><span className="text-zinc-400">URL:</span> {selectedLog.url}</p>
                    <p><span className="text-zinc-400">Method:</span> {selectedLog.method}</p>
                    <p><span className="text-zinc-400">Time:</span> {selectedLog.timestamp}</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Response Body</label>
                    <button 
                      onClick={() => navigator.clipboard.writeText(JSON.stringify(selectedLog.body, null, 2))}
                      className="text-[10px] text-indigo-600 hover:underline"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className="p-4 bg-zinc-900 rounded-lg text-[11px] font-mono text-indigo-300 overflow-x-auto leading-relaxed border border-zinc-800">
                    {JSON.stringify(selectedLog.body, null, 2)}
                  </pre>
                </div>

                {selectedLog.type === 'Mock' && (
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800 rounded-lg">
                    <div className="flex items-center text-indigo-700 dark:text-indigo-300 text-xs font-bold mb-1">
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Mock Intercepted
                    </div>
                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400 leading-relaxed">
                      This request was intercepted by a local mock rule. No actual network call was made.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[60] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl py-1.5 min-w-[200px] animate-in fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => {
              addUrlFilter(contextMenu.url);
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
          >
            <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
            Hide this exact URL
          </button>
          <button
            onClick={() => {
              try {
                const urlObj = new URL(contextMenu.url);
                addUrlFilter(urlObj.pathname);
              } catch {
                const path = contextMenu.url.split('?')[0];
                addUrlFilter(path);
              }
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
          >
            <Filter className="w-3.5 h-3.5 text-zinc-400" />
            Hide by path pattern
          </button>
          <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />
          <button
            onClick={() => {
              // Pre-fill mock with URL path and method from the log entry
              let pattern = contextMenu.url;
              try {
                const urlObj = new URL(contextMenu.url);
                pattern = urlObj.pathname;
              } catch {
                pattern = contextMenu.url.split('?')[0];
              }
              const existingBody = contextMenu.body && typeof contextMenu.body === 'object'
                ? JSON.stringify(contextMenu.body, null, 2)
                : '{\n  "status": "success"\n}';
              setNewMock({
                pattern,
                method: contextMenu.method || 'GET',
                status: typeof contextMenu.status === 'number' ? contextMenu.status : 200,
                body: existingBody
              });
              setIsMockModalOpen(true);
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
          >
            <Settings className="w-3.5 h-3.5 text-indigo-500" />
            Create mock for this URL
          </button>
          <button
            onClick={() => {
              // Pre-fill with just the domain/host as pattern
              let pattern = contextMenu.url;
              try {
                const urlObj = new URL(contextMenu.url);
                pattern = urlObj.host;
              } catch { /* use full url */ }
              setNewMock({
                pattern,
                method: contextMenu.method || 'GET',
                status: 200,
                body: '{\n  "status": "success"\n}'
              });
              setIsMockModalOpen(true);
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
          >
            <Settings className="w-3.5 h-3.5 text-purple-500" />
            Create mock for this host
          </button>
          <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />
          <button
            onClick={() => {
              try {
                const urlObj = new URL(contextMenu.url);
                const ext = urlObj.pathname.split('.').pop();
                if (ext && ext.length <= 5) {
                  addUrlFilter(`\\.${ext}$`, true);
                }
              } catch { /* ignore */ }
              setContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 text-zinc-700 dark:text-zinc-200"
          >
            <Regex className="w-3.5 h-3.5 text-amber-500" />
            Hide by file extension (regex)
          </button>
        </div>
      )}

      {/* URL Filter Modal */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 p-6 overflow-hidden">
            <h3 className="text-lg font-bold mb-1">Add URL Filter</h3>
            <p className="text-zinc-500 text-xs mb-6">Requests matching this pattern will be hidden from the network log.</p>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1 block">Pattern</label>
                <input 
                  autoFocus
                  value={newFilter.pattern}
                  onChange={e => setNewFilter({...newFilter, pattern: e.target.value})}
                  onKeyDown={e => e.key === 'Enter' && handleAddFilter()}
                  placeholder={newFilter.isRegex ? 'e.g. \\.ico$|\\.png$' : 'e.g. /favicon.ico'}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNewFilter({...newFilter, isRegex: !newFilter.isRegex})}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    newFilter.isRegex 
                      ? 'bg-amber-50 border-amber-200 text-amber-700' 
                      : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                  }`}
                >
                  <Regex className="w-3 h-3" />
                  {newFilter.isRegex ? 'Regex enabled' : 'Plain text'}
                </button>
              </div>
              {newFilter.isRegex && newFilter.pattern && (() => {
                try { new RegExp(newFilter.pattern); return null; }
                catch { return <p className="text-[11px] text-red-500">Invalid regex pattern</p>; }
              })()}
            </div>

            <div className="mt-8 flex justify-end gap-2">
              <button onClick={() => { setIsFilterModalOpen(false); setNewFilter({ pattern: '', isRegex: false }); }} className="px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Cancel</button>
              <button onClick={handleAddFilter} className="px-6 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 shadow-lg shadow-red-100 dark:shadow-red-900/20">Add Filter</button>
            </div>
          </div>
        </div>
      )}

      {/* Domain Modal */}
      {isDomainModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 p-6 overflow-hidden">
            <h3 className="text-lg font-bold mb-1">Add Domain</h3>
            <p className="text-zinc-500 dark:text-zinc-400 text-xs mb-6">Specify base URLs to flag in the network log.</p>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1 block">Hostname / Pattern</label>
                <input 
                  autoFocus
                  value={newDomain}
                  onChange={e => setNewDomain(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && handleAddDomain()}
                  placeholder="e.g. api.stripe.com" 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-2">
              <button onClick={() => setIsDomainModalOpen(false)} className="px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Cancel</button>
              <button onClick={handleAddDomain} className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20">Add Tracked Domain</button>
            </div>
          </div>
        </div>
      )}

      {/* Mock Modal */}
      {isMockModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 p-8 overflow-hidden">
            <h3 className="text-xl font-bold mb-1">{editingMockId !== null ? 'Edit Mock Rule' : 'Create Mock Rule'}</h3>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-8">{editingMockId !== null ? 'Update the mock rule configuration below.' : 'Requests matching this pattern will return the body defined below.'}</p>
            
            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 block">URL Pattern (contains string)</label>
                <input 
                  autoFocus
                  value={newMock.pattern}
                  onChange={e => setNewMock({...newMock, pattern: e.target.value})}
                  placeholder="/api/v1/users/profile" 
                  className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 block">HTTP Method</label>
                  <select 
                    value={newMock.method}
                    onChange={e => setNewMock({...newMock, method: e.target.value})}
                    className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none"
                  >
                    <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 block">Response Status</label>
                  <input 
                    type="number" 
                    value={newMock.status}
                    onChange={e => setNewMock({...newMock, status: parseInt(e.target.value)})}
                    className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 block">JSON Body</label>
                <textarea 
                  rows={Math.min(20, Math.max(6, newMock.body.split('\n').length + 1))}
                  value={newMock.body}
                  onChange={e => setNewMock({...newMock, body: e.target.value})}
                  className="w-full px-4 py-3 bg-zinc-900 text-indigo-300 border border-zinc-800 rounded-xl text-xs font-mono outline-none focus:border-indigo-500/50 transition-all leading-relaxed max-h-[50vh] overflow-y-auto resize-y"
                />
              </div>
            </div>

            <div className="mt-10 flex justify-end gap-3">
              <button onClick={() => { setIsMockModalOpen(false); setEditingMockId(null); setNewMock({ pattern: '', method: 'GET', status: 200, body: '{\n  "status": "success"\n}' }); }} className="px-5 py-2.5 text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Cancel</button>
              <button onClick={handleAddMock} className="px-8 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 dark:shadow-indigo-900/20 transition-all">{editingMockId !== null ? 'Save Changes' : 'Create Rule'}</button>
            </div>
          </div>
        </div>
      )}
      {/* Swagger Import Modal */}
      {isSwaggerModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 p-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-bold">Import from Swagger / OpenAPI</h3>
              <button onClick={() => setIsSwaggerModalOpen(false)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">Paste a Swagger 2.0 or OpenAPI 3.x spec (JSON or YAML), or upload a file. Mock rules will be generated from the response schemas.</p>

            {/* File upload */}
            <div className="mb-4">
              <label className="inline-flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors">
                <FileUp className="w-4 h-4" />
                Upload spec file
                <input type="file" accept=".json,.yaml,.yml" className="hidden" onChange={handleSwaggerFileUpload} />
              </label>
            </div>

            {/* Text input */}
            <textarea
              rows={8}
              value={swaggerInput}
              onChange={e => { setSwaggerInput(e.target.value); setSwaggerResult(null); }}
              placeholder='{\n  "openapi": "3.0.0",\n  "info": { "title": "My API", ... },\n  "paths": { ... }\n}'
              className="w-full px-4 py-3 bg-zinc-900 text-green-300 border border-zinc-800 rounded-xl text-xs font-mono outline-none focus:border-indigo-500/50 transition-all leading-relaxed mb-4 resize-none"
            />

            {/* Parse button */}
            {!swaggerResult && (
              <button
                onClick={handleSwaggerParse}
                disabled={!swaggerInput.trim()}
                className="self-start px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-4"
              >
                Parse Spec
              </button>
            )}

            {/* Error */}
            {swaggerResult?.error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400 mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {swaggerResult.error}
              </div>
            )}

            {/* Results */}
            {swaggerResult && !swaggerResult.error && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="font-bold">{swaggerResult.title}</span>
                    {swaggerResult.version && <span className="text-zinc-400 ml-2">v{swaggerResult.version}</span>}
                    <span className="text-zinc-400 ml-2">&middot; {swaggerResult.rules.length} endpoint{swaggerResult.rules.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button onClick={toggleAllSwaggerRules} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300">
                    {swaggerSelectedIds.size === swaggerResult.rules.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-1.5 mb-4" style={{ maxHeight: '240px' }}>
                  {swaggerResult.rules.map(rule => (
                    <label
                      key={rule.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                        swaggerSelectedIds.has(rule.id)
                          ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800'
                          : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-100 dark:border-zinc-700 opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={swaggerSelectedIds.has(rule.id)}
                        onChange={() => toggleSwaggerRule(rule.id)}
                        className="accent-indigo-600 w-3.5 h-3.5"
                      />
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                        rule.method === 'GET' ? 'bg-emerald-100 text-emerald-700'
                        : rule.method === 'POST' ? 'bg-blue-100 text-blue-700'
                        : rule.method === 'PUT' ? 'bg-amber-100 text-amber-700'
                        : rule.method === 'DELETE' ? 'bg-red-100 text-red-700'
                        : 'bg-zinc-100 text-zinc-500'
                      }`}>{rule.method}</span>
                      <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1" title={rule.pattern}>{rule.pattern}</span>
                      <span className="text-[10px] text-zinc-400">{rule.status}</span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <button onClick={() => setIsSwaggerModalOpen(false)} className="px-5 py-2.5 text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Cancel</button>
                  <button
                    onClick={handleSwaggerImport}
                    disabled={swaggerSelectedIds.size === 0}
                    className="px-8 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 dark:shadow-indigo-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Import {swaggerSelectedIds.size} Rule{swaggerSelectedIds.size !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}

            {/* Footer when no result yet */}
            {!swaggerResult && (
              <div className="mt-auto flex justify-end pt-4">
                <button onClick={() => setIsSwaggerModalOpen(false)} className="px-5 py-2.5 text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold">Settings</h3>
              <button onClick={() => setIsSettingsModalOpen(false)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Dark Mode Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-3">
                  {isDarkMode ? <Moon className="w-5 h-5 text-indigo-500" /> : <Sun className="w-5 h-5 text-amber-500" />}
                  <div>
                    <p className="text-sm font-semibold">Appearance</p>
                    <p className="text-[11px] text-zinc-400">{isDarkMode ? 'Dark mode' : 'Light mode'}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${isDarkMode ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isDarkMode ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {/* AI Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-3">
                  <Sparkles className={`w-5 h-5 ${isAIEnabled ? 'text-purple-500' : 'text-zinc-400'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">AI Mock Data</p>
                      <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 text-[9px] font-bold uppercase rounded">Beta</span>
                    </div>
                    <p className="text-[11px] text-zinc-400">Generate realistic mock responses with AI</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAIEnabled(!isAIEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${isAIEnabled ? 'bg-purple-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isAIEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {isAIEnabled && (
                <div className="space-y-3">
                  {/* GitHub PAT input */}
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 block">
                      GitHub Personal Access Token
                    </label>
                    <input
                      type="password"
                      value={githubPat}
                      onChange={e => setGithubPat(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                    />
                    <p className="text-[10px] text-zinc-400 mt-1">
                      Required for AI generation via GitHub Models API. Stored locally.
                    </p>
                  </div>

                  {/* Model selector */}
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 block">
                      AI Model
                    </label>
                    <select
                      value={aiModel}
                      onChange={e => setAiModel(e.target.value as 'gpt-4o-mini' | 'gpt-4o')}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                    >
                      <option value="gpt-4o-mini">GPT-4o Mini (faster)</option>
                      <option value="gpt-4o">GPT-4o (higher quality)</option>
                    </select>
                  </div>

                  {/* Status indicator */}
                  <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
                    <p className="text-[11px] text-purple-700 dark:text-purple-300 leading-relaxed">
                      {githubPat
                        ? 'AI mock data generation is active. New and updated mock rules will automatically get AI-enhanced response bodies.'
                        : 'Enter your GitHub PAT above to enable AI-powered mock data generation. You can also set GITHUB_TOKEN env var on the proxy server.'
                      }
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex justify-end">
              <button onClick={() => setIsSettingsModalOpen(false)} className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
