// CommandHistoryPanel.tsx
//
// NOTA DE MIGRAÇÃO (v1.4.0):
// O Command Stream foi integrado ao CodeCanvas como uma aba nativa.
// Este arquivo é mantido apenas para compatibilidade com importações
// existentes que possam referenciar o componente diretamente.
// A lógica completa agora vive em components/CodeCanvas.tsx (CommandStream).
//
// Se algum componente ainda importar <CommandHistoryPanel />, ele renderizará
// null silenciosamente. Remover este arquivo após confirmar que não há
// importações diretas restantes.

import React from 'react';

interface CommandHistoryPanelProps {
  [key: string]: any;
}

const CommandHistoryPanel: React.FC<CommandHistoryPanelProps> = () => {
  // Intencionalmente vazio — funcionalidade migrada para CodeCanvas
  return null;
};

export default CommandHistoryPanel;
