import { useCommand } from '@anaisbetts/commands'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { Bug, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { firstValueFrom, share, toArray } from 'rxjs'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { ChatMessage } from '../components/chat-message'
import { DriverSelector, ModelSelector } from '../components/llm-selector'
import { useWebSocket } from '../components/ws-provider'

export default function Chat() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<MessageParam[]>([])
  const [driver, setDriver] = useState<string>('anthropic')
  const [model, setModel] = useState<string>('')
  const [currentConversationId, setCurrentConversationId] = useState<
    number | undefined
  >(undefined)
  const [isDebugMode, setIsDebugMode] = useState<boolean>(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { api } = useWebSocket()

  const [sendPrompt, result, reset] = useCommand(async () => {
    const before = performance.now()

    if (!api) throw new Error('Not connected!')
    if (!model) throw new Error('No model selected!')

    // Keep messages if continuing a conversation, otherwise clear them
    if (!currentConversationId) {
      setMessages([])
    }

    const msgCall = api
      .handlePromptRequest(
        input,
        `${driver}/${model}`,
        currentConversationId,
        isDebugMode ? 'debug' : 'chat'
      )
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
  }, [input, model, driver, api, currentConversationId, isDebugMode])

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
    setIsDebugMode(false)
  }, [reset])

  // Reset chat but preserve input text
  const resetChatKeepInput = useCallback(() => {
    reset()
    setMessages([])
    setCurrentConversationId(undefined)
    setIsDebugMode(false)
  }, [reset])

  const handleModelChange = useCallback(
    (newModel: string) => {
      setModel(newModel)
      resetChatKeepInput()
    },
    [resetChatKeepInput]
  )

  const handleDriverChange = useCallback(
    (value: string) => {
      setDriver(value)
      resetChatKeepInput()
    },
    [resetChatKeepInput]
  )

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
        <div className="flex items-center gap-2">
          <DriverSelector
            driver={driver}
            onDriverChange={handleDriverChange}
            disabled={result.isPending()}
          />

          <ModelSelector
            driver={driver}
            model={model}
            onModelChange={handleModelChange}
            disabled={result.isPending()}
          />

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

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={isDebugMode ? 'secondary' : 'outline'}
                  size="icon"
                  onClick={() => setIsDebugMode((prev) => !prev)}
                  disabled={result.isPending() || !!currentConversationId}
                >
                  <Bug size={18} />
                  <span className="sr-only">Toggle Debug Mode</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Debug - disable system prompt</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </form>
      </div>
    </div>
  )
}
