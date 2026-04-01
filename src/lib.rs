//! Claude Code Rust - High-performance CLI for Claude AI
//!
//! A complete Rust implementation of Claude Code, featuring:
//! - Async-first architecture with Tokio
//! - Native terminal UI with Ratatui
//! - MCP protocol support
//! - Voice input support
//! - Memory management and team sync
//! - Plugin system

pub mod cli;
pub mod tools;
pub mod api;
pub mod config;
pub mod state;
pub mod mcp;
pub mod voice;
pub mod memory;
pub mod plugins;
pub mod utils;
pub mod services;
pub mod session;
pub mod terminal;

pub use cli::Cli;
pub use state::AppState;
pub use tools::ToolRegistry;
pub use api::AnthropicClient;
pub use config::Settings;
pub use mcp::McpManager;
pub use voice::VoiceInput;
pub use memory::MemoryManager;
pub use plugins::PluginManager;
