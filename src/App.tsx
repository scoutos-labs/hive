import { useState, useEffect, useRef } from 'react';
import { useChannels, useAgents, useChannel, useSSE } from './hooks/data';
import { api, type Post } from './api/hive';
import './styles.css';

// Main App
export default function App() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const { channels, loading: channelsLoading } = useChannels();
  
  // Select first channel by default
  useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      setSelectedChannelId(channels[0].id);
    }
  }, [channels, selectedChannelId]);

  return (
    <div className="app">
      <Sidebar
        channels={channels}
        loading={channelsLoading}
        selectedChannelId={selectedChannelId}
        onSelectChannel={setSelectedChannelId}
      />
      <Main channelId={selectedChannelId} />
    </div>
  );
}

// Sidebar
function Sidebar({ 
  channels, 
  loading, 
  selectedChannelId,
  onSelectChannel 
}: { 
  channels: ReturnType<typeof useChannels>['channels'];
  loading: boolean;
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
}) {
  const { agents, loading: agentsLoading } = useAgents();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">🐝</div>
          <span>Hive</span>
        </div>
      </div>
      
      <div className="sidebar-section">
        <div className="sidebar-section-title">Channels</div>
        {loading ? (
          <div className="sidebar-item" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : channels.length === 0 ? (
          <div className="sidebar-item" style={{ color: 'var(--text-muted)' }}>No channels</div>
        ) : (
          channels.map(channel => (
            <div
              key={channel.id}
              className={`sidebar-item ${selectedChannelId === channel.id ? 'active' : ''}`}
              onClick={() => onSelectChannel(channel.id)}
            >
              <span className="sidebar-item-icon">#</span>
              <span className="sidebar-item-name">{channel.name}</span>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Agents</div>
        {agentsLoading ? (
          <div className="sidebar-item" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : (
          agents.map(agent => (
            <div key={agent.id} className="agent-item">
              <div className="agent-avatar">
                {agent.id.charAt(0).toUpperCase()}
              </div>
              <div className="agent-item-info">
                <div className="agent-item-name">{agent.name}</div>
                <div className="agent-item-status">idle</div>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// Main content area
function Main({ channelId }: { channelId: string | null }) {
  const { channel, channels, posts, loading, refetchPosts } = useChannel(channelId);
  const { events, connected } = useSSE('/api/events/stream');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new posts arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts]);

  // Refetch posts when SSE event arrives
  useEffect(() => {
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      if (lastEvent.type === 'task.completed' || lastEvent.type === 'task.failed') {
        refetchPosts();
      }
    }
  }, [events, refetchPosts]);

  return (
    <div className="main">
      <header className="main-header">
        {channel ? (
          <>
            <h1 className="main-title">#{channel.name}</h1>
            <div className="main-meta">
              <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}>
                <span className={`status-dot ${connected ? 'completed' : 'idle'}`}></span>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </>
        ) : (
          <h1 className="main-title">Select a channel</h1>
        )}
      </header>

      <div className="messages-container">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">⏳</div>
            <div className="empty-state-title">Loading...</div>
          </div>
        ) : !channel ? (
          <div className="empty-state">
            <div className="empty-state-icon">🐝</div>
            <div className="empty-state-title">Welcome to Hive</div>
            <div className="empty-state-desc">Select a channel from the sidebar to start chatting with agents.</div>
          </div>
        ) : posts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-title">No messages yet</div>
            <div className="empty-state-desc">Be the first to post in #{channel.name}. Use @agent to mention agents.</div>
          </div>
        ) : (
          <>
            {posts.map(post => (
              <Message key={post.id} post={post} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {channel && (
        <Composer channelId={channel.id} onSend={refetchPosts} />
      )}
    </div>
  );
}

// Message component
function Message({ post }: { post: Post }) {
  const { agents } = useAgents();
  const agent = agents.find(a => a.id === post.authorId);
  const isAgent = agent !== undefined;
  
  // Format timestamp
  const time = new Date(post.createdAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  // Highlight @mentions
  const formatContent = (content: string) => {
    const parts = content.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} style={{ color: 'var(--accent)' }}>{part}</span>;
      }
      return part;
    });
  };

  return (
    <div className={`message ${isAgent ? 'agent' : ''}`}>
      <div className="agent-avatar">
        {isAgent ? '🤖' : '👤'}
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-author">{post.authorId}</span>
          <span className="message-time">{time}</span>
        </div>
        <div className="message-body">{formatContent(post.content)}</div>
      </div>
    </div>
  );
}

// Composer component
function Composer({ channelId, onSend }: { channelId: string; onSend: () => void }) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async () => {
    if (!content.trim() || sending) return;
    
    setSending(true);
    try {
      await api.createPost({
        channelId,
        authorId: 'user', // TODO: proper user ID
        content: content.trim(),
      });
      setContent('');
      onSend();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="composer">
      <div className="input-wrapper">
        <textarea
          ref={inputRef}
          className="input"
          placeholder="Type a message... Use @agent to mention agents"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          autoFocus
        />
        <button
          className="input-submit"
          onClick={handleSubmit}
          disabled={!content.trim() || sending}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}