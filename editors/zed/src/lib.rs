use zed_extension_api::{self as zed, Command, Extension, LanguageServerId, Result, Worktree};

struct BelExtension;

impl Extension for BelExtension {
    fn new() -> Self {
        Self
    }

    /// `bel-lsp` on the path is all the language server needs: diagnostics,
    /// hover and level completion all come from the compiler.
    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<Command> {
        Ok(Command {
            command: "bel-lsp".into(),
            args: vec!["--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(BelExtension);
