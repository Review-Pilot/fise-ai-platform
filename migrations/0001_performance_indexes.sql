-- Indexes for the hottest dashboard, widget and auth queries.
-- Safe to run repeatedly: `npx wrangler d1 migrations apply DB --remote`
CREATE INDEX IF NOT EXISTS idx_chatbots_user_created ON chatbots(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_chatbot_created ON conversations(chatbot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_chatbot_created ON leads(chatbot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_chatbot_created ON crawl_jobs(chatbot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_updated ON subscriptions(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);
CREATE TABLE IF NOT EXISTS newsletter_subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'website');
