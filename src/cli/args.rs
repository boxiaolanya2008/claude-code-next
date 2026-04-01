//! CLI Arguments

use super::CliArgs;

pub type Cli = CliArgs;

impl Cli {
    /// Run the CLI application
    pub fn run(&self, state: crate::state::AppState) -> anyhow::Result<()> {
        // Handle version flag
        if self.version {
            println!("claude-code-rust {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }

        // Handle info flag
        if self.info {
            self.print_system_info();
            return Ok(());
        }

        // Handle subcommands
        match &self.command {
            Some(super::Commands::Repl { prompt }) => {
                self.run_repl(state, prompt.clone())?;
            }
            Some(super::Commands::Query { prompt }) => {
                self.run_query(state, prompt.clone())?;
            }
            Some(super::Commands::Config { action }) => {
                self.run_config(action)?;
            }
            Some(super::Commands::Mcp { action }) => {
                self.run_mcp(action)?;
            }
            Some(super::Commands::Plugin { action }) => {
                self.run_plugin(action)?;
            }
            Some(super::Commands::Memory { action }) => {
                self.run_memory(action)?;
            }
            Some(super::Commands::Voice { push_to_talk }) => {
                self.run_voice(state, *push_to_talk)?;
            }
            Some(super::Commands::Init { name }) => {
                self.run_init(name.clone())?;
            }
            Some(super::Commands::Update) => {
                self.run_update()?;
            }
            Some(super::Commands::Help { topic }) => {
                self.run_help(topic.clone())?;
            }
            None => {
                // Default: start REPL
                self.run_repl(state, None)?;
            }
        }

        Ok(())
    }

    fn print_system_info(&self) {
        println!("System Information:");
        println!("  Version: {}", env!("CARGO_PKG_VERSION"));
        println!("  OS: {}", std::env::consts::OS);
        println!("  Arch: {}", std::env::consts::ARCH);
        println!("  Working Dir: {}", std::env::current_dir().unwrap().display());
    }

    fn run_repl(&self, state: crate::state::AppState, prompt: Option<String>) -> anyhow::Result<()> {
        let repl = crate::cli::repl::Repl::new(state);
        repl.start(prompt)?;
        Ok(())
    }

    fn run_query(&self, state: crate::state::AppState, prompt: String) -> anyhow::Result<()> {
        // Execute single query
        let client = crate::api::AnthropicClient::new(state.settings.clone());
        let response = client.query(&prompt)?;
        println!("{}", response);
        Ok(())
    }

    fn run_config(&self, action: &super::ConfigCommands) -> anyhow::Result<()> {
        match action {
            super::ConfigCommands::Show => {
                let settings = crate::config::Settings::load()?;
                println!("{}", serde_json::to_string_pretty(&settings)?);
            }
            super::ConfigCommands::Set { key, value } => {
                crate::config::Settings::set(key, value)?;
                println!("Set {} = {}", key, value);
            }
            super::ConfigCommands::Reset => {
                crate::config::Settings::reset()?;
                println!("Configuration reset to defaults");
            }
        }
        Ok(())
    }

    fn run_mcp(&self, action: &super::McpCommands) -> anyhow::Result<()> {
        match action {
            super::McpCommands::List => {
                let servers = crate::mcp::McpManager::list_servers()?;
                for server in servers {
                    println!("  - {} ({})", server.name, server.status);
                }
            }
            super::McpCommands::Add { name, command } => {
                crate::mcp::McpManager::add_server(name, command)?;
                println!("Added MCP server: {}", name);
            }
            super::McpCommands::Remove { name } => {
                crate::mcp::McpManager::remove_server(name)?;
                println!("Removed MCP server: {}", name);
            }
            super::McpCommands::Restart { name } => {
                crate::mcp::McpManager::restart_server(name)?;
                println!("Restarted MCP server: {}", name);
            }
        }
        Ok(())
    }

    fn run_plugin(&self, action: &super::PluginCommands) -> anyhow::Result<()> {
        match action {
            super::PluginCommands::List => {
                let plugins = crate::plugins::PluginManager::list()?;
                for plugin in plugins {
                    println!("  - {} v{}", plugin.name, plugin.version);
                }
            }
            super::PluginCommands::Install { plugin } => {
                crate::plugins::PluginManager::install(plugin)?;
                println!("Installed plugin: {}", plugin);
            }
            super::PluginCommands::Remove { name } => {
                crate::plugins::PluginManager::remove(name)?;
                println!("Removed plugin: {}", name);
            }
            super::PluginCommands::Update => {
                crate::plugins::PluginManager::update_all()?;
                println!("All plugins updated");
            }
        }
        Ok(())
    }

    fn run_memory(&self, action: &super::MemoryCommands) -> anyhow::Result<()> {
        match action {
            super::MemoryCommands::Status => {
                let status = crate::memory::MemoryManager::status()?;
                println!("Memory Status:");
                println!("  Sessions: {}", status.session_count);
                println!("  Memories: {}", status.memory_count);
                println!("  Last Consolidation: {:?}", status.last_consolidation);
            }
            super::MemoryCommands::Clear => {
                crate::memory::MemoryManager::clear()?;
                println!("All memories cleared");
            }
            super::MemoryCommands::Export { output } => {
                crate::memory::MemoryManager::export(output)?;
                println!("Memories exported to: {}", output.display());
            }
            super::MemoryCommands::Import { input } => {
                crate::memory::MemoryManager::import(input)?;
                println!("Memories imported from: {}", input.display());
            }
            super::MemoryCommands::Dream => {
                println!("Running memory consolidation (dream)...");
                crate::memory::MemoryManager::dream()?;
                println!("Memory consolidation completed");
            }
        }
        Ok(())
    }

    fn run_voice(&self, state: crate::state::AppState, push_to_talk: bool) -> anyhow::Result<()> {
        let voice = crate::voice::VoiceInput::new(state);
        voice.start(push_to_talk)?;
        Ok(())
    }

    fn run_init(&self, name: Option<String>) -> anyhow::Result<()> {
        let project_name = name.unwrap_or_else(|| "claude-code-project".to_string());
        crate::utils::project::init_project(&project_name)?;
        println!("Initialized project: {}", project_name);
        Ok(())
    }

    fn run_update(&self) -> anyhow::Result<()> {
        println!("Checking for updates...");
        // TODO: Implement update logic
        println!("Already at latest version");
        Ok(())
    }

    fn run_help(&self, topic: Option<String>) -> anyhow::Result<()> {
        match topic {
            Some(t) => println!("Help for topic: {}", t),
            None => println!("Use --help for detailed usage information"),
        }
        Ok(())
    }
}