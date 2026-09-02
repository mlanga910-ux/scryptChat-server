export function detectCodeLanguage(code: string): string {
  const trimmed = code.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}') || trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }

  if (trimmed.includes('import React') || trimmed.includes('export const') || trimmed.includes(': React.FC') || trimmed.includes('useState(') || trimmed.includes('<div') || trimmed.includes('interface ')) {
    return 'typescript';
  }

  if (trimmed.includes('def ') || trimmed.includes('import numpy') || trimmed.includes('print(') && trimmed.includes(':')) {
    return 'python';
  }

  if (trimmed.includes('fn main()') || trimmed.includes('let mut ') || trimmed.includes('impl ')) {
    return 'rust';
  }

  if (trimmed.includes('package main') || trimmed.includes('func ') || trimmed.includes('fmt.Println')) {
    return 'go';
  }

  if (trimmed.includes('#include <') || trimmed.includes('std::cout') || trimmed.includes('int main(')) {
    return 'cpp';
  }

  if (trimmed.includes('<!DOCTYPE html>') || trimmed.includes('<html') || trimmed.includes('<body')) {
    return 'html';
  }

  if (trimmed.includes('SELECT ') && trimmed.includes('FROM ') || trimmed.includes('CREATE TABLE')) {
    return 'sql';
  }

  if (trimmed.startsWith('#!/bin/bash') || trimmed.startsWith('#!/bin/sh') || trimmed.includes('sudo ') || trimmed.includes('npm install') || trimmed.includes('curl -')) {
    return 'bash';
  }

  return 'text';
}

export function parseMarkdownCodeBlock(text: string): { code: string; language: string; title?: string } | null {
  const match = text.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*?)```$/);
  if (match) {
    return {
      language: match[1] || 'text',
      code: match[2],
      title: match[1] ? `snippet.${match[1]}` : 'snippet.txt',
    };
  }
  return null;
}
