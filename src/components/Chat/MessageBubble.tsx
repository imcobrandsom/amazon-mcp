import React from 'react';
import type { LocalMessage } from '../../types';
import clsx from 'clsx';

interface Props {
  message: LocalMessage;
}

// Lightweight markdown renderer — handles tables, code, bold, bullets
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (
      i + 1 < lines.length &&
      lines[i + 1].match(/^\|[\s\-|]+\|$/)
    ) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      nodes.push(<MarkdownTable key={key++} lines={tableLines} />);
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <pre key={key++} className="bg-slate-100 p-3 rounded text-xs font-mono overflow-x-auto my-2 whitespace-pre-wrap">
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    // Heading
    if (line.startsWith('### ')) {
      nodes.push(<h3 key={key++} className="font-semibold text-slate-900 text-sm mt-3 mb-1 first:mt-0">{inlineFormat(line.slice(4))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(<h2 key={key++} className="font-semibold text-slate-900 text-sm mt-3 mb-1 first:mt-0">{inlineFormat(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(<h1 key={key++} className="font-semibold text-slate-900 text-base mt-3 mb-1 first:mt-0">{inlineFormat(line.slice(2))}</h1>);
      i++;
      continue;
    }

    // List items
    if (line.match(/^[\-\*] /)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*] /)) {
        items.push(<li key={i}>{inlineFormat(lines[i].slice(2))}</li>);
        i++;
      }
      nodes.push(<ul key={key++} className="list-disc pl-4 my-1.5 space-y-0.5 text-sm">{items}</ul>);
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={i}>{inlineFormat(lines[i].replace(/^\d+\. /, ''))}</li>);
        i++;
      }
      nodes.push(<ol key={key++} className="list-decimal pl-4 my-1.5 space-y-0.5 text-sm">{items}</ol>);
      continue;
    }

    // Blank line / paragraph break
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    nodes.push(
      <p key={key++} className="text-sm leading-relaxed mb-1.5 last:mb-0">
        {inlineFormat(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

function inlineFormat(text: string): React.ReactNode {
  // Bold + code inline
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={i} className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">{p.slice(1, -1)}</code>;
    }
    return p;
  });
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines.map((l) =>
    l
      .split('|')
      .filter((_, i, arr) => i > 0 && i < arr.length - 1)
      .map((cell) => cell.trim())
  );

  const [header, , ...body] = rows;

  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {header?.map((h, i) => (
              <th
                key={i}
                className="bg-slate-100 text-left px-3 py-1.5 font-semibold text-slate-700 border border-slate-200"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="even:bg-slate-50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 border border-slate-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-brand-500 text-white rounded-2xl rounded-tr-sm px-4 py-2.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        {message.isStreaming ? (
          <div className="flex items-center gap-1 py-1">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : (
          <div className="text-slate-800">
            {renderMarkdown(message.content)}
          </div>
        )}
      </div>
    </div>
  );
}
