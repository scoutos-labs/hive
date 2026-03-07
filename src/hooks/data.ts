import { useState, useEffect } from 'react';
import { api, type Channel, type Post, type Agent, type Mention } from '../api/hive';

// Channels hook
export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = async () => {
    try {
      setLoading(true);
      const data = await api.getChannels();
      setChannels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch channels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  return { channels, loading, error, refetch: fetchChannels };
}

// Posts hook
export function usePosts(channelId: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = async () => {
    if (!channelId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await api.getPosts(channelId);
      // Sort by creation time, oldest first for chat
      setPosts(data.sort((a, b) => a.createdAt - b.createdAt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch posts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [channelId]);

  return { posts, loading, error, refetch: fetchPosts };
}

// Agents hook
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgents() {
      try {
        setLoading(true);
        const data = await api.getAgents();
        setAgents(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoading(false);
      }
    }
    fetchAgents();
  }, []);

  return { agents, loading, error };
}

// Mentions hook (for active tasks)
export function useMentions(agentId?: string) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMentions() {
      try {
        setLoading(true);
        const data = await api.getMentions(agentId);
        // Sort by creation time, most recent first
        setMentions(data.sort((a, b) => b.createdAt - a.createdAt));
      } catch (err) {
        console.error('Failed to fetch mentions:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchMentions();
  }, [agentId]);

  return { mentions, loading, refetch: () => api.getMentions(agentId).then(setMentions) };
}

// SSE hook for real-time events
export function useSSE(url: string) {
  const [events, setEvents] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(url);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        setEvents(prev => [...prev.slice(-99), event]);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [url]);

  return { events, connected };
}

// Combined hook for channel view
export function useChannel(channelId: string | null) {
  const { posts, loading: postsLoading, refetch: refetchPosts } = usePosts(channelId);
  const { channels, loading: channelsLoading } = useChannels();

  const channel = channelId ? channels.find(c => c.id === channelId) : null;

  return {
    channel,
    channels,
    posts,
    loading: postsLoading || channelsLoading,
    refetchPosts,
  };
}