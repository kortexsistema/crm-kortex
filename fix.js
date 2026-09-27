const fs = require('fs');
let c = fs.readFileSync('supabase/migrations/MANIFEST.md', 'utf8');
c = c.trim() + '\n| `20260915120000` | `0239_remove_source_from_agents` | Remover coluna source dos agentes |\n';
fs.writeFileSync('supabase/migrations/MANIFEST.md', c, 'utf8');
