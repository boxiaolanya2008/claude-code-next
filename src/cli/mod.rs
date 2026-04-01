//! CLI Module - Command Line Interface

pub mod args;
pub mod commands;
pub mod repl;

pub use args::Cli;
pub use repl::Repl;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

/// Claude Code - AI-powered coding assistant
#[derive(Parser, Debug)]
#[command(name = "claude-code")]
#[command(author = "Anthropic")]
#[command(version = "0.1.0")]
#[command(about = "High-performance Rust implementation of Claude Code CLI")]
pub struct CliArgs {
    /// Path to the project directory
    #[arg(short, long, value_name = "PATH")]
    pub path: Option<PathBuf>,

    /// Model to use (sonnet, opus, haiku)
    #[arg(short, long, default_value = "sonnet")]
    pub model: String,

    /// Enable verbose logging
    #[arg(short, long)]
    pub verbose: bool,

    /// Run in non-interactive mode
    #[arg(short, long)]
    pub no_interactive: bool,

    /// Print version information
    #[arg(long)]
    pub version: bool,

    /// Print system information
    #[arg(long)]
    pub info: bool,

    /// Subcommands
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Start an interactive REPL session
    Repl {
        /// Initial prompt to send
        #[arg(short, long)]
        prompt: Option<String>,
    },

    /// Execute a single query
    Query {
        /// The query to execute
        #[arg(short, long)]
        prompt: String,
    },

    /// Manage configuration settings
    Config {
        #[command(subcommand)]
        action: ConfigCommands,
    },

    /// Manage MCP servers
    Mcp {
        #[command(subcommand)]
        action: McpCommands,
    },

    /// Manage plugins
    Plugin {
        #[command(subcommand)]
        action: PluginCommands,
    },

    /// Manage memory and sessions
    Memory {
        #[command(subcommand)]
        action: MemoryCommands,
    },

    /// Voice input mode
    Voice {
        /// Enable push-to-talk mode
        #[arg(short, long)]
        push_to_talk: bool,
    },

    /// Initialize a new project
    Init {
        /// Project name
        #[arg(short, long)]
        name: Option<String>,
    },

    /// Update to latest version
    Update,

    /// Show help and usage information
    Help {
        /// Topic to show help for
        #[arg(short, long)]
        topic: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub enum ConfigCommands {
    /// Show current configuration
    Show,

    /// Set a configuration value
    Set {
        /// Configuration key
        key: String,
        /// Configuration value
        value: String,
    },

    /// Reset configuration to defaults
    Reset,
}

#[derive(Subcommand, Debug)]
pub enum McpCommands {
    /// List configured MCP servers
    List,

    /// Add a new MCP server
    Add {
        /// Server name
        name: String,
        /// Server command
        command: String,
    },

    /// Remove an MCP server
    Remove {
        /// Server name
        name: String,
    },

    /// Restart an MCP server
    Restart {
        /// Server name
        name: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum PluginCommands {
    /// List installed plugins
    List,

    /// Install a plugin
    Install {
        /// Plugin name or URL
        plugin: String,
    },

    /// Remove a plugin
    Remove {
        /// Plugin name
        name: String,
    },

    /// Update all plugins
    Update,
}

#[derive(Subcommand, Debug)]
pub enum MemoryCommands {
    /// Show memory status
    Status,

    /// Clear all memories
    Clear,

    /// Export memories
    Export {
        /// Output file path
        #[arg(short, long)]
        output: PathBuf,
    },

    /// Import memories
    Import {
        /// Input file path
        input: PathBuf,
    },

    /// Run memory consolidation (dream)
    Dream,
}