'use client'

import { useState, useRef, useCallback, JSX, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send, ChevronDown } from 'lucide-react'
import { useCommand } from '@anaisbetts/commands'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { cx } from '@/lib/utils'
import { useWebSocket } from './ws-provider'
import { firstValueFrom, share, toArray } from 'rxjs'
import { Remark } from 'react-remark'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export default function Chat() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<MessageParam[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { api } = useWebSocket()

  const [sendPrompt, result, reset] = useCommand(async () => {
    const before = performance.now()
    if (!api) throw new Error('Not connected!')

    setMessages([])

    const msgCall = api.handlePromptRequest(input).pipe(share())
    const msgs: MessageParam[] = []

    msgCall.subscribe({
      next: (x) => {
        msgs.push(x)
        setMessages([...msgs])
      },
      error: () => {},
    })

    const result = await firstValueFrom(msgCall.pipe(toArray()))

    console.log('done?')
    return {
      messages: result as MessageParam[],
      duration: performance.now() - before,
    }
  }, [input])

  const resetChat = useCallback(() => {
    reset()
    setMessages([])
    setInput('')
  }, [reset, setInput])

  const msgContent = useMemo(() => {
    return (
      <div className="flex flex-col gap-2">
        {messages.map((msg, i) => (
          <ChatMessage
            key={`message-${i}`}
            msg={msg}
            isLast={i === messages.length - 1}
          />
        ))}
      </div>
    )
  }, [messages])

  const requestInfo = result.mapOrElse({
    ok: (val) => (
      <div className="pt-2 italic">Request took {val?.duration}ms</div>
    ),
    err: (e) => <div className="text-gray-400 italic">It didn't. {e}</div>,
    pending: () => null,
    null: () => null,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Chat Session</h2>
        <Button variant="outline" size="sm" onClick={resetChat}>
          New Chat
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {msgContent}
        {requestInfo}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-border border-t p-4">
        <form onSubmit={sendPrompt} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1"
            disabled={result.isPending()}
          />

          <Button type="submit" disabled={result.isPending() || !input.trim()}>
            <Send size={18} />
            <span className="sr-only">Send message</span>
          </Button>
        </form>
      </div>
    </div>
  )
}

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
      console.log('text!', msg.text)
      content = <Remark>{msg.text ?? ''}</Remark>
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
