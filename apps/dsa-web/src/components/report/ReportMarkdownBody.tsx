import type React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ReportMarkdownBodyProps {
  allowImages?: boolean;
  content: string;
  className?: string;
  testId?: string;
}

export const ReportMarkdownBody: React.FC<ReportMarkdownBodyProps> = ({
  content,
  className = '',
  testId,
  allowImages = true,
}) => (
  <div
    data-testid={testId}
    className={`home-markdown-prose prose prose-invert prose-sm max-w-none
      prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
      prose-h1:text-xl
      prose-h2:text-lg
      prose-h3:text-base
      prose-p:leading-relaxed prose-p:mb-3 prose-p:last:mb-0
      prose-strong:text-foreground prose-strong:font-semibold
      prose-ul:my-2 prose-ol:my-2 prose-li:my-1
      prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      prose-pre:border
      prose-table:border-collapse
      prose-hr:my-4
      prose-a:no-underline hover:prose-a:underline
      prose-blockquote:text-secondary-text
      whitespace-pre-line break-words
      ${className}
    `}
  >
    <Markdown remarkPlugins={[remarkGfm]} components={allowImages ? undefined : { img: () => null }}>
      {content}
    </Markdown>
  </div>
);
