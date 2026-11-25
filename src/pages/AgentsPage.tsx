import { useState } from 'react';
import { Bot, Check, ChevronDown, Copy, ExternalLink, Sparkles, Terminal } from 'lucide-react';

type AgentHarness = 'claude' | 'omp_pi' | 'cursor_windsurf' | 'codex';

export function AgentsPage() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeHarness, setActiveHarness] = useState<AgentHarness>('claude');
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://shipcheck.vercel.app';

  const universalCommand = `curl -fsSL "${origin}/api/setup" | sh`;
  const agentPrompt = `Configure ShipCheck for yourself by running \`curl -fsSL "${origin}/api/setup" | sh\` (or register HTTP MCP at ${origin}/api/mcp and read ${origin}/SKILL.md), then audit my staging or preview URL with shipcheck_audit_url.`;

  const harnessSnippets: Record<AgentHarness, { title: string; subtitle: string; cmd: string }> = {
    claude: {
      title: 'Claude Code CLI',
      subtitle: 'Registers HTTP MCP directly via the official Claude CLI plus installs SKILL.md.',
      cmd: `claude mcp add --transport http shipcheck "${origin}/api/mcp" && mkdir -p ~/.claude/skills/shipcheck && curl -fsSL "${origin}/SKILL.md" -o ~/.claude/skills/shipcheck/SKILL.md`,
    },
    omp_pi: {
      title: 'OMP (oh-my-pi) & Pi Coding Agent',
      subtitle: 'Installs ShipCheck skill + HTTP MCP entry so OMP or Pi can audit URLs via MCP or curl.',
      cmd: `curl -fsSL "${origin}/api/setup" | sh`,
    },
    cursor_windsurf: {
      title: 'Cursor & Windsurf',
      subtitle: 'Merges ShipCheck HTTP MCP into ~/.cursor/mcp.json and ~/.codeium/windsurf/mcp_config.json.',
      cmd: `curl -fsSL "${origin}/api/setup" | sh`,
    },
    codex: {
      title: 'OpenAI Codex CLI',
      subtitle: 'Adds [mcp_servers.shipcheck] to ~/.codex/config.toml and installs .agents/skills/shipcheck/SKILL.md.',
      cmd: `curl -fsSL "${origin}/api/setup" | sh`,
    },
  };

  const mcpRemoteConfig = JSON.stringify(
    {
      mcpServers: {
        shipcheck: {
          type: 'http',
          url: `${origin}/api/mcp`,
        },
      },
    },
    null,
    2
  );

  const handleCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const currentHarness = harnessSnippets[activeHarness];

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 py-14 sm:py-20 space-y-14">
      <div className="space-y-4 max-w-2xl">
        <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-700 dark:text-emerald-400">
          <Bot className="w-4 h-4" />
          <span>Agent &amp; MCP Ready</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
          One Command for Any Coding Agent
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Skip hand-editing JSON files. Run one installer command or paste one prompt so Claude Code, OMP, Pi, Cursor, Windsurf, or Codex configures ShipCheck automatically.
        </p>
      </div>

      {/* Primary Option 1 & 2: Zero-Config One-Liner + Agent Self-Setup Prompt */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-7 sm:p-8 space-y-5 flex flex-col justify-between">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              1. Single-Command Auto-Setup
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Safely installs <code className="font-mono text-xs">SKILL.md</code> and merges ShipCheck MCP into Claude Code, OMP, Pi, Cursor, Windsurf, and Codex without overwriting existing configs.
            </p>
          </div>

          <div className="space-y-4">
            <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 text-xs font-mono text-zinc-800 dark:text-zinc-200 overflow-x-auto">
              {universalCommand}
            </pre>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a
                href="/api/setup"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Inspect setup script
              </a>
              <button
                type="button"
                onClick={() => void handleCopy('universal', universalCommand)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedKey === 'universal' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Command Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Install Command
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-7 sm:p-8 space-y-5 flex flex-col justify-between">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              2. Let Your Agent Configure Itself
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Paste this single sentence into Claude, OMP, Pi, Cursor, or Codex and let the agent wire its own MCP server and skill.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 text-xs font-mono text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {agentPrompt}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a
                href="/SKILL.md"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View SKILL.md
              </a>
              <button
                type="button"
                onClick={() => void handleCopy('prompt', agentPrompt)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedKey === 'prompt' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Prompt Copied
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Copy Agent Prompt
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Harness Tabs */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-7 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              By Agent Harness
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {currentHarness.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 self-start">
            {(
              [
                ['claude', 'Claude Code'],
                ['omp_pi', 'OMP & Pi'],
                ['cursor_windsurf', 'Cursor & Windsurf'],
                ['codex', 'Codex CLI'],
              ] as Array<[AgentHarness, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveHarness(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeHarness === key
                    ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <pre className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 text-xs font-mono text-zinc-800 dark:text-zinc-300 overflow-x-auto">
            {currentHarness.cmd}
          </pre>
          <button
            type="button"
            onClick={() => void handleCopy(`harness-${activeHarness}`, currentHarness.cmd)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedKey === `harness-${activeHarness}` ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>

        {/* Tools Exposed */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5 border-t border-zinc-200 dark:border-zinc-800">
          {[
            {
              name: 'shipcheck_audit_url',
              desc: 'Runs a pre-launch scan on any public URL and returns score, grade, and critical findings.',
            },
            {
              name: 'shipcheck_get_report',
              desc: 'Retrieves a completed report and Markdown remediation steps by shareSlug.',
            },
            {
              name: 'shipcheck_trigger_deploy_check',
              desc: 'Triggers a tracked project deploy webhook and returns the resulting shareable report URL.',
            },
          ].map((tool) => (
            <div key={tool.name} className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                <Terminal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {tool.name}
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{tool.desc}</p>
            </div>
          ))}
        </div>

        {/* Optional Manual JSON Fallback (Collapsed by default) */}
        <details className="pt-4 border-t border-zinc-200 dark:border-zinc-800 group">
          <summary className="list-none flex items-center justify-between cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            <span>Manual HTTP MCP JSON (if you prefer configuring by hand)</span>
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 space-y-3">
            <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 text-xs font-mono text-zinc-800 dark:text-zinc-300 overflow-x-auto">
              {mcpRemoteConfig}
            </pre>
            <button
              type="button"
              onClick={() => void handleCopy('manual-json', mcpRemoteConfig)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedKey === 'manual-json' ? 'JSON Copied' : 'Copy JSON'}
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
