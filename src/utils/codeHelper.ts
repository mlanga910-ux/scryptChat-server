export interface ParsedMessagePart {
  type: 'text' | 'code';
  content: string;
  language?: string;
  title?: string;
  lineCount?: number;
}

export function getCodeFileExtension(lang: string): string {
  const normalized = (lang || '').toLowerCase().trim();
  const map: Record<string, string> = {
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    js: 'js',
    jsx: 'jsx',
    python: 'py',
    py: 'py',
    rust: 'rs',
    rs: 'rs',
    go: 'go',
    golang: 'go',
    cpp: 'cpp',
    'c++': 'cpp',
    c: 'c',
    csharp: 'cs',
    'c#': 'cs',
    cs: 'cs',
    java: 'java',
    kotlin: 'kt',
    kt: 'kt',
    swift: 'swift',
    php: 'php',
    ruby: 'rb',
    rb: 'rb',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    sql: 'sql',
    bash: 'sh',
    sh: 'sh',
    shell: 'sh',
    zsh: 'sh',
    markdown: 'md',
    md: 'md',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    svg: 'svg',
    dockerfile: 'dockerfile',
    text: 'txt',
    txt: 'txt',
  };
  return map[normalized] || (normalized.length <= 4 && normalized ? normalized : 'txt');
}

export function detectCodeLanguage(code: string): string {
  const trimmed = code.trim();

  // JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }

  // HTML / XML
  if (trimmed.includes('<!DOCTYPE html>') || (trimmed.includes('<html') && trimmed.includes('</html>')) || (trimmed.includes('<body') && trimmed.includes('</body>'))) {
    return 'html';
  }

  // TypeScript / React / TSX
  if (
    trimmed.includes('import React') ||
    trimmed.includes('export const ') ||
    trimmed.includes(': React.FC') ||
    trimmed.includes('useState<') ||
    trimmed.includes('useEffect(') ||
    trimmed.includes('interface ') ||
    trimmed.includes('type ') && trimmed.includes(' = ')
  ) {
    return 'typescript';
  }

  // JavaScript
  if (
    trimmed.includes('console.log(') ||
    trimmed.includes('const ') && trimmed.includes(' = ') ||
    trimmed.includes('let ') && trimmed.includes(' = ') ||
    trimmed.includes('function(') ||
    trimmed.includes('=> {') ||
    trimmed.includes('require(') ||
    trimmed.includes('module.exports')
  ) {
    return 'javascript';
  }

  // Python
  if (
    trimmed.includes('def ') ||
    trimmed.includes('import numpy') ||
    trimmed.includes('import os') ||
    trimmed.includes('from ') && trimmed.includes(' import ') ||
    (trimmed.includes('print(') && trimmed.includes(':')) ||
    trimmed.includes('elif ') ||
    trimmed.includes('if __name__ ==')
  ) {
    return 'python';
  }

  // Rust
  if (trimmed.includes('fn main()') || trimmed.includes('let mut ') || trimmed.includes('impl ') || trimmed.includes('pub fn ') || trimmed.includes('println!(')) {
    return 'rust';
  }

  // Go
  if (trimmed.includes('package main') || trimmed.includes('func ') || trimmed.includes('fmt.Println') || trimmed.includes('import "fmt"')) {
    return 'go';
  }

  // C / C++
  if (trimmed.includes('#include <') || trimmed.includes('std::cout') || trimmed.includes('int main(') || trimmed.includes('std::vector')) {
    return 'cpp';
  }

  // SQL
  if (
    (trimmed.toUpperCase().includes('SELECT ') && trimmed.toUpperCase().includes('FROM ')) ||
    trimmed.toUpperCase().includes('INSERT INTO ') ||
    trimmed.toUpperCase().includes('CREATE TABLE ') ||
    trimmed.toUpperCase().includes('WHERE ')
  ) {
    return 'sql';
  }

  // Bash / Shell
  if (
    trimmed.startsWith('#!/bin/bash') ||
    trimmed.startsWith('#!/bin/sh') ||
    trimmed.includes('sudo ') ||
    trimmed.includes('npm install') ||
    trimmed.includes('pnpm add') ||
    trimmed.includes('yarn add') ||
    trimmed.includes('git commit') ||
    trimmed.includes('curl -') ||
    trimmed.includes('chmod +x')
  ) {
    return 'bash';
  }

  return 'text';
}

/**
 * Checks if raw text without markdown is likely a pasted code snippet
 */
export function isLikelyRawCode(text: string): boolean {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');
  if (lines.length < 2 && trimmed.length < 40) return false;

  const detected = detectCodeLanguage(trimmed);
  if (detected !== 'text') return true;

  // Multi-line with indentation or coding syntax
  let codeIndicators = 0;
  if (/^[ \t]{2,}/m.test(trimmed)) codeIndicators += 2; // indented lines
  if (/[{};]$/m.test(trimmed)) codeIndicators += 2; // lines ending with ; or {}
  if (/\b(function|return|if\s*\(|for\s*\(|while\s*\(|class\s+\w+|const\s+\w+|let\s+\w+|var\s+\w+)\b/.test(trimmed)) codeIndicators += 3;
  if (/(=>|\/\/|\/\*|\*\/|===|!==|&&|\|\|)/.test(trimmed)) codeIndicators += 2;
  if (/^\s*import\s+.+\s+from\s+['"].+['"]/m.test(trimmed)) codeIndicators += 3;
  if (/^\s*export\s+(default|const|function|class)/m.test(trimmed)) codeIndicators += 3;

  return codeIndicators >= 4;
}

/**
 * Parses message text into text and code blocks, supporting multiple markdown code fences
 * or automatically detecting unformatted code pastes.
 */
export function parseMessageContent(text: string): ParsedMessagePart[] {
  if (!text) return [];

  // Match markdown code blocks: ```lang ... ``` or ``` ... ```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  const parts: ParsedMessagePart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      parts.push({
        type: 'text',
        content: textBefore,
      });
    }

    const lang = (match[1] || '').trim().toLowerCase() || detectCodeLanguage(match[2]);
    const codeContent = match[2].replace(/\r\n/g, '\n');
    const ext = getCodeFileExtension(lang);

    parts.push({
      type: 'code',
      content: codeContent,
      language: lang || 'text',
      title: `snippet.${ext}`,
      lineCount: codeContent.split('\n').length,
    });

    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    // If no markdown blocks were found at all and the entire message is raw code
    if (parts.length === 0 && isLikelyRawCode(remaining)) {
      const lang = detectCodeLanguage(remaining);
      const ext = getCodeFileExtension(lang);
      parts.push({
        type: 'code',
        content: remaining.replace(/\r\n/g, '\n'),
        language: lang,
        title: `snippet.${ext}`,
        lineCount: remaining.split('\n').length,
      });
    } else {
      parts.push({
        type: 'text',
        content: remaining,
      });
    }
  }

  return parts;
}

export function parseMarkdownCodeBlock(text: string): { code: string; language: string; title?: string } | null {
  const parts = parseMessageContent(text);
  if (parts.length === 1 && parts[0].type === 'code') {
    return {
      code: parts[0].content,
      language: parts[0].language || 'text',
      title: parts[0].title || 'snippet.txt',
    };
  }
  return null;
}

export function downloadCodeSnippet(code: string, language: string, title?: string): void {
  const ext = getCodeFileExtension(language);
  const filename = title && title.includes('.') ? title : `code_${Date.now()}.${ext}`;
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
