import WebSocket from 'ws';
import { Observable, Subject } from 'rxjs';
import debug from 'debug';

const d = debug('ha-websocket');

interface HAAuth {
  type: 'auth';
  access_token: string;
}

interface HAAuthResponse {
  type: 'auth_ok' | 'auth_invalid';
  ha_version?: string;
}

interface HAEvent {
  id: number;
  type: 'event';
  event: {
    event_type: string;
    data: any;
    origin: string;
    time_fired: string;
    context: {
      id: string;
      parent_id: string | null;
      user_id: string | null;
    };
  };
}

interface HAEventSubscription {
  id: number;
  type: 'subscribe_events';
  event_type?: string;
}

class HomeAssistantWebsocket {
  private ws: WebSocket | null = null;
  private messageId = 1;
  private events = new Subject<HAEvent>();
  private token: string;
  private url: string;
  private isConnected = false;

  constructor(url?: string, token?: string) {
    this.url = url || process.env.HA_BASE_URL || '';
    this.token = token || process.env.HA_TOKEN || '';
    
    if (!this.url) throw new Error('Home Assistant URL is required');
    if (!this.token) throw new Error('Home Assistant access token is required');
    
    // Convert http(s):// to ws(s)://
    this.url = this.url.replace(/^http/, 'ws') + '/api/websocket';
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      d('Connecting to Home Assistant at', this.url);
      
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        d('WebSocket connection established');
      });
      
      this.ws.on('message', (data: string) => {
        const message = JSON.parse(data);
        d('Received message:', message);
        
        // Handle authentication
        if (message.type === 'auth_required') {
          this.authenticate();
        } else if (message.type === 'auth_ok') {
          d('Authentication successful');
          this.isConnected = true;
          resolve();
        } else if (message.type === 'auth_invalid') {
          const error = new Error('Authentication failed');
          this.ws?.close();
          reject(error);
        } else if (message.type === 'event') {
          this.events.next(message as HAEvent);
        }
      });
      
      this.ws.on('error', (error) => {
        d('WebSocket error:', error);
        reject(error);
      });
      
      this.ws.on('close', () => {
        d('WebSocket connection closed');
        this.isConnected = false;
      });
    });
  }

  private authenticate(): void {
    if (!this.ws) return;
    
    const authMessage: HAAuth = {
      type: 'auth',
      access_token: this.token
    };
    
    d('Sending authentication message');
    this.ws.send(JSON.stringify(authMessage));
  }

  public subscribeToEvents(eventType?: string): Observable<HAEvent> {
    if (!this.isConnected) {
      throw new Error('Not connected to Home Assistant');
    }
    
    const subscriptionMessage: HAEventSubscription = {
      id: this.messageId++,
      type: 'subscribe_events',
      ...(eventType ? { event_type: eventType } : {})
    };
    
    d('Subscribing to events', eventType ? `of type: ${eventType}` : 'all events');
    this.ws?.send(JSON.stringify(subscriptionMessage));
    
    return this.events.asObservable();
  }

  public disconnect(): void {
    if (this.ws) {
      d('Disconnecting from Home Assistant');
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

async function main() {
  try {
    const client = new HomeAssistantWebsocket();
    await client.connect();
    
    d('Connected to Home Assistant, subscribing to all events');
    const events = client.subscribeToEvents();
    
    events.subscribe(event => {
      console.log(`Event: ${event.event.event_type}`, event.event.data);
    });
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('Received SIGINT, closing connection');
      client.disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error('Error connecting to Home Assistant:', error);
    process.exit(1);
  }
}

main().catch(console.error);