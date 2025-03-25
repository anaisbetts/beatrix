'use client'

import { useState, useRef, useCallback, JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send } from 'lucide-react'
import { useCommand } from '@anaisbetts/commands'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { cx } from '@/lib/utils'
import { useWebSocket } from './ws-provider'
import { firstValueFrom } from 'rxjs'

export default function Chat() {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { api } = useWebSocket()

  const [sendPrompt, result, reset] = useCommand(async () => {
    const before = performance.now()
    if (!api) throw new Error('Not connected!')

    const messages = await firstValueFrom(api.handlePromptRequest(input))

    return {
      messages: messages as MessageParam[],
      duration: performance.now() - before,
    }
  }, [input])

  const resetChat = useCallback(() => {
    reset()
    setInput('')
  }, [reset, setInput])

  const messages = result.mapOrElse({
    ok: (val) => {
      if (!val) return null
      return (
        <div className="flex flex-col gap-2">
          {val.messages.map((msg, index) => (
            <ChatMessage key={`message-${index}`} msg={msg} />
          ))}
          <div className="pt-2 italic">Request took {val.duration}ms</div>
        </div>
      )
    },
    err: (e) => <div className="text-gray-400 italic">It didn't. {e}</div>,
    pending: () => null,
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
        {messages}
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

export function ChatMessage({ msg }: { msg: MessageParam }) {
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
      {content.map((cb, index) => (
        <ContentBlock key={`content-${index}`} msg={cb} />
      ))}
    </div>
  )
}

export function ContentBlock({ msg }: { msg: ContentBlockParam }) {
  let content: JSX.Element

  switch (msg.type) {
    case 'text':
      content = <>{msg.text}</>
      break
    case 'tool_use':
      content = (
        <>
          Calling tool {msg.name}, {JSON.stringify(msg.input)}
        </>
      )
      break
    case 'tool_result':
      content = <>Tool returned {JSON.stringify(msg.content)}</>
      break
    default:
      content = <>'Dunno!'</>
  }

  return <div className="overflow-auto">{content}</div>
}
