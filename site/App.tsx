import Chat from '@/components/chat'
import Evals from '@/components/evals'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './components/ui/sidebar'
import { MessageSquare, Beaker } from 'lucide-react'
import { useIsMobile } from './hooks/use-mobile'
import { useCallback, useMemo, useState } from 'react'

interface AppSidebarProps {
  onPageClicked: (page: string) => unknown
}

function AppSidebar({ onPageClicked }: AppSidebarProps) {
  const { open, isMobile, toggleSidebar } = useSidebar()

  const headerContent =
    open || isMobile ? (
      <h2 className="text-2xl text-nowrap">Agentic Automation</h2>
    ) : null

  const nav = useCallback(
    (page: string) => {
      if (isMobile) toggleSidebar()

      onPageClicked(page)
    },
    [isMobile]
  )

  const bg = isMobile ? 'bg-white' : ''

  return (
    <>
      <SidebarHeader className={bg}>{headerContent}</SidebarHeader>
      <SidebarContent className={bg}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="#" onClick={() => nav('debug')}>
                    <MessageSquare size={18} />
                    <span className="ms-1">Debug Chat</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="#" onClick={() => nav('evals')}>
                    <Beaker size={18} />
                    <span className="ms-1">Evals</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  )
}

export default function Home() {
  const defaultOpen = useIsMobile()
  const [page, setPage] = useState('debug')

  const mainContent = useMemo(() => {
    switch (page) {
      case 'debug':
        return <Chat />
      case 'evals':
        return <Evals />
      default:
        throw new Error('u blew it')
    }
  }, [page])

  return (
    <div className="bg-background min-h-screen max-w-screen">
      <SidebarProvider defaultOpen={defaultOpen}>
        <Sidebar variant="floating" collapsible="icon">
          <AppSidebar onPageClicked={setPage} />
        </Sidebar>

        <main className="flex w-full flex-1 flex-row">
          <div className="flex-1">{mainContent}</div>
          <SidebarTrigger className="mt-5 mr-2" />
        </main>
      </SidebarProvider>
    </div>
  )
}
