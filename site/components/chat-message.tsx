import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import type { Root } from 'mdast'
import { JSX, useMemo, useState } from 'react'
import { Remark } from 'react-remark'

import { cx } from '@/lib/utils'

import { Button } from './ui/button'

export function ChatMessage({
  msg,
  isLast,
}: {
  msg: MessageParam
  isLast: boolean
}) {
  const color = msg.role === 'assistant' ? 'bg-primary-400' : 'bg-secondary-400'

  const content =
    msg.content instanceof Array
      ? msg.content
      : [{ type: 'text', text: msg.content } as ContentBlockParam]
  return (
    <div
      className={cx(
        color,
        'flex flex-col gap-1 rounded-2xl border-2 border-gray-500 p-2'
      )}
    >
      {content.map((cb, i) => (
        <ContentBlock key={`content-${i}`} msg={cb} isLastMsg={isLast} />
      ))}
    </div>
  )
}

export function TextContentBlock({ text }: { text: string }) {
  const escaped = useMemo(() => crappyEscaper(text), [text])
  return <Remark>{escaped}</Remark>
}

export function ContentBlock({
  msg,
  isLastMsg,
}: {
  msg: ContentBlockParam
  isLastMsg: boolean
}) {
  let content: JSX.Element
  const [isOpen, setIsOpen] = useState(false)

  switch (msg.type) {
    case 'text':
      content = <TextContentBlock text={msg.text ?? ''} />
      break
    case 'tool_use':
      const spinner = isLastMsg ? (
        <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
      ) : null

      content = (
        <div className="text-muted-foreground flex items-center gap-2 p-1 text-sm font-medium">
          {spinner}
          Calling tool {msg.name}...
        </div>
      )
      break
    case 'tool_result':
      content = (
        <Collapsible
          className="w-full rounded border p-2"
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Tool Result</span>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ChevronDown className="h-4 w-4" />
                <span className="sr-only">Toggle</span>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pt-2">
            <pre className="bg-muted overflow-auto rounded p-2 text-sm">
              {JSON.stringify(msg.content, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )
      break
    default:
      content = <>'Dunno!'</>
  }

  return <div className="overflow-auto">{content}</div>
}

const matchers: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function crappyEscaper(text: string) {
  return Object.keys(matchers).reduce(
    (acc, k) => acc.replaceAll(k, matchers[k]),
    text
  )
}
