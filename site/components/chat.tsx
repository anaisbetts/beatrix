'use client'

import { useState, useRef, useCallback, JSX, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send, ChevronDown } from 'lucide-react'
import { useCommand, usePromise } from '@anaisbetts/commands'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModelDriverType } from '../../shared/types'

export default function Chat() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<MessageParam[]>([])
  const [driver, setDriver] = useState<ModelDriverType>('anthropic')
  const [model, setModel] = useState<string>('')
  const [currentConversationId, setCurrentConversationId] = useState<
    number | undefined
  >(undefined)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { api } = useWebSocket()

  const driverList = usePromise(async () => {
    if (!api) return []
    return await firstValueFrom(api.getDriverList())
  }, [api])

  const modelList = usePromise(async () => {
    if (!api) return []
    const models = await firstValueFrom(api.getModelListForDriver(driver))
    if (models.length > 0 && !model) {
      setModel(models[0])
    }
    return models
  }, [api, driver])

  const [sendPrompt, result, reset] = useCommand(async () => {
    const before = performance.now()
    if (!api) throw new Error('Not connected!')
    if (!model) throw new Error('No model selected!')

    // Keep messages if continuing a conversation, otherwise clear them
    if (!currentConversationId) {
      setMessages([])
    }

    const msgCall = api
      .handlePromptRequest(input, model, driver, currentConversationId)
      .pipe(share())
    const msgs: MessageParam[] = []

    msgCall.subscribe({
      next: (x) => {
        msgs.push(x)

        // Track the conversation ID from the first message with serverId
        const msgWithServerId = x as any
        if (msgWithServerId.serverId && !currentConversationId) {
          // Convert BigInt to number to avoid JSON serialization issues
          setCurrentConversationId(Number(msgWithServerId.serverId))
        }

        // If continuing a conversation, append to existing messages
        if (currentConversationId) {
          setMessages((prev) => [...prev, x])
        } else {
          setMessages([...msgs])
        }
      },
      error: () => {},
    })

    const result = await firstValueFrom(msgCall.pipe(toArray()))

    // Clear the input after message is sent and processed
    setInput('')

    return {
      messages: result as MessageParam[],
      duration: performance.now() - before,
    }
  }, [input, model, driver, api, currentConversationId])

  // Focus the input field when the command completes
  useEffect(() => {
    if (result.isOk() && inputRef.current) {
      inputRef.current.focus()
    }
  }, [result])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const resetChat = useCallback(() => {
    reset()
    setMessages([])
    setInput('')
    setCurrentConversationId(undefined)
  }, [reset])

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

  const driverSelector = driverList.mapOrElse({
    ok: (drivers) => (
      <Select
        value={driver}
        onValueChange={(value) => {
          setDriver(value as ModelDriverType)
          // Reset conversation when changing drivers
          resetChat()
        }}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Select driver" />
        </SelectTrigger>
        <SelectContent>
          {drivers.map((d) => (
            <SelectItem key={d} value={d}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
    err: () => (
      <div className="text-sm text-red-500">Failed to load drivers</div>
    ),
    pending: () => (
      <div className="flex h-10 w-[180px] items-center justify-center">
        <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
      </div>
    ),
    null: () => <div className="text-sm italic">Select a driver</div>,
  })

  const modelSelector = modelList.mapOrElse({
    ok: (models) => (
      <Select
        value={model}
        onValueChange={(value) => {
          setModel(value)
          // Reset conversation when changing models
          resetChat()
        }}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
    err: () => (
      <div className="text-sm text-red-500">Failed to load models</div>
    ),
    pending: () => (
      <div className="flex h-10 w-[180px] items-center justify-center">
        <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
      </div>
    ),
    null: () => <div className="text-sm italic">Select a driver</div>,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Chat Session</h2>
        <div className="flex items-center gap-2">
          {driverSelector}

          {modelSelector}
          <Button variant="outline" size="lg" onClick={resetChat}>
            New Chat
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {msgContent}
        {requestInfo}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-border border-t p-4">
        <form onSubmit={sendPrompt} className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1"
            disabled={result.isPending()}
          />

          <Button
            type="submit"
            disabled={result.isPending() || !input.trim() || !model}
          >
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
