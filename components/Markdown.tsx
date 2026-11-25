"use client";

import { isValidElement, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

function nodeText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node) && node.props && typeof node.props === "object" && "children" in node.props) {
    return nodeText(node.props.children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => nodeText(children), [children]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard permission is best effort.
    }
  };
  return (
    <div className="code-wrap">
      <button type="button" className="code-copy" onClick={copy} aria-label="复制代码">
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children: code }) => <CodeBlock>{code}</CodeBlock>,
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          ),
          img: ({ alt }) => <span className="md-image">[图片{alt ? `: ${alt}` : ""}]</span>,
          table: ({ children: table }) => (
            <div className="table-wrap">
              <table>{table}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
