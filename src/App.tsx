import { useState, useEffect, useRef, useMemo } from 'react';
import { useChannels, useAgents, useChannel, useSSE } from './hooks/data';
import { api, type Post } from './api/hive';
import './styles.css';

// Mention autocomplete component
function MentionAutocomplete({
  query,
  agents,
  position,
  onSelect,
  onClose
}: {
  query: string;
  agents: { id: string; name: string }[];
  position: { top: number; left: number };
  onSelect: (agentId: string) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    if (!query) return agents;
    const q = query.toLowerCase();
    return agents.filter(a => 
      a.id.toLowerCase().includes(q) || 
      a.name.toLowerCase().includes(q)
    );
  }, [query, agents]);

  if (filtered.length === 0) return null;

  return (
    <div 
      className="mention-autocomplete"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map(agent => (
        <div 
          key={agent.id} 
          className="mention-option"
          onClick={() => onSelect(agent.id)}
        >
          <span className="mention-option-icon">🤖</span>
          <span className="mention-option-name">{agent.name}</span>
          <span className="mention-option-id">@{agent.id}</span>
        </div>
      ))}
    </div>
  );
}

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

      <button 
        className="sidebar-new-channel"
        onClick={() => {
          const name = prompt('Channel name:');
          if (name) {
            api.createChannel({ name, createdBy: 'user' });
          }
        }}
      >
        + New Channel
      </button>
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { agents } = useAgents();

  const handleSubmit = async () => {
    if (!content.trim() || sending) return;
    
    setSending(true);
    try {
      await api.createPost({
        channelId,
        authorId: 'user',
        content: content.trim(),
      });
      setContent('');
      setMentionQuery(null);
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
    if (e.key === 'Escape') {
      setMentionQuery(null);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // Check for @mention trigger
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      // Calculate position for dropdown
      const textarea = e.target;
      const rect = textarea.getBoundingClientRect();
      setMentionPosition({
        top: rect.height,
        left: 0
      });
    } else {
      setMentionQuery(null);
    }
  };

  const handleMentionSelect = (agentId: string) => {
    if (!inputRef.current) return;
    
    const cursorPos = inputRef.current.selectionStart;
    const textBeforeCursor = content.substring(0, cursorPos);
    const textAfterCursor = content.substring(cursorPos);
    
    // Replace @partial with @agentId
    const newText = textBeforeCursor.replace(/@\w*$/, `@${agentId} `) + textAfterCursor;
    setContent(newText);
    setMentionQuery(null);
    
    // Focus back on input
    inputRef.current.focus();
  };

  return (
    <div className="composer">
      <div className="input-wrapper">
        <textarea
          ref={inputRef}
          className="input"
          placeholder="Type a message... Use @agent to mention agents"
          value={content}
          onChange={handleInput}
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
      
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          agents={agents}
          position={mentionPosition}
          onSelect={handleMentionSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}
    </div>
  );
}