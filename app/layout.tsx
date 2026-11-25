import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent 会话管理",
  description: "分层读取、全文检索与安全清理本地 pi / omp 编码 Agent 会话",
};

const themeScript = `(function(){try{var t=localStorage.getItem('asm-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
