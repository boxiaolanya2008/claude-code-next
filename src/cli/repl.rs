//! REPL Module - Interactive Read-Eval-Print Loop

use crate::state::AppState;
use std::io::{self, BufRead, Write};

/// Interactive REPL
pub struct Repl {
    state: AppState,
}

impl Repl {
    /// Create a new REPL
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    
    /// Start the REPL
    pub fn start(&self, initial_prompt: Option<String>) -> anyhow::Result<()> {
        println!("Claude Code Rust REPL");
        println!("Type 'exit' or 'quit' to exit, 'help' for commands");
        println!();
        
        // Handle initial prompt if provided
        if let Some(prompt) = initial_prompt {
            self.process_input(&prompt)?;
        }
        
        // Start interactive loop
        let stdin = io::stdin();
        let mut stdout = io::stdout();
        
        loop {
            // Print prompt
            print!("> ");
            stdout.flush()?;
            
            // Read input
            let mut input = String::new();
            stdin.lock().read_line(&mut input)?;
            let input = input.trim();
            
            // Handle commands
            if input.is_empty() {
                continue;
            }
            
            if input == "exit" || input == "quit" {
                println!("Goodbye!");
                break;
            }
            
            if input == "help" {
                self.print_help();
                continue;
            }
            
            if input == "status" {
                self.print_status();
                continue;
            }
            
            if input == "clear" {
                self.clear_screen();
                continue;
            }
            
            // Process as query
            self.process_input(input)?;
        }
        
        Ok(())
    }
    
    fn process_input(&self, input: &str) -> anyhow::Result<()> {
        // Create API client
        let client = crate::api::AnthropicClient::new(self.state.settings.clone());
        
        // Execute query
        println!("Processing...");
        let response = client.query(input)?;
        
        // Print response
        println!();
        println!("{}", response);
        println!();
        
        Ok(())
    }
    
    fn print_help(&self) {
        println!("Available commands:");
        println!("  help    - Show this help message");
        println!("  status  - Show current status");
        println!("  clear   - Clear the screen");
        println!("  exit    - Exit the REPL");
        println!("  quit    - Exit the REPL");
        println!();
        println!("Any other input will be sent as a query to Claude.");
        println!();
    }
    
    fn print_status(&self) {
        println!("Status:");
        println!("  Max Tokens: {}", self.state.settings.api.max_tokens);
        println!("  Working Dir: {}", self.state.settings.working_dir.display());
        println!("  API Key: {}", if self.state.settings.api.api_key.is_some() { "Set" } else { "Not set" });
        println!();
    }
    
    fn clear_screen(&self) {
        print!("\x1B[2J\x1B[1;1H");
        io::stdout().flush().ok();
    }
}