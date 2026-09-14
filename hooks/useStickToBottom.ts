// =============================================================================
// useStickToBottom.ts — rolagem "presa no fim" para listas que crescem
//
// Regra: a lista só acompanha o conteúdo novo enquanto o usuário estiver no fim.
// Assim que ele rola para cima, a posição fica onde está — ler uma mensagem
// antiga não é mais interrompido pelo próximo chunk — e quem faz o retorno ao
// fim é o botão de seta que `isAtBottom === false` libera.
//
// O crescimento é observado com ResizeObserver no elemento de conteúdo, e não
// por dependências de render: durante o streaming a mesma mensagem cresce sem
// que nenhuma prop mude, e só o observer enxerga isso.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseStickToBottomOptions {
  /** Distância do fim, em px, ainda considerada "no fim". */
  threshold?: number;
}

export const useStickToBottom = <TScroll extends HTMLElement = HTMLDivElement, TContent extends HTMLElement = HTMLDivElement>(
  { threshold = 80 }: UseStickToBottomOptions = {}
) => {
  const scrollRef = useRef<TScroll | null>(null);
  const contentRef = useRef<TContent | null>(null);
  // Espelho síncrono de `isAtBottom`: o observer dispara fora do ciclo de render
  // e não pode depender do estado ainda não aplicado.
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance <= threshold;
    stickRef.current = atBottom;
    setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
  }, [threshold]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    // `isAtBottom` não é marcado aqui de propósito: com rolagem suave a chegada
    // leva alguns frames e pode ser interrompida no caminho. Quem atualiza o
    // estado é o `measure` disparado pelos eventos de scroll da própria
    // animação, então o botão só some quando a lista realmente chegou ao fim.
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    if (behavior === 'auto') measure();
  }, [measure]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current ?? (el?.firstElementChild as TContent | null);
    if (!el || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        // 'auto' de propósito: durante o streaming, uma animação por chunk
        // nunca termina e a lista fica sempre alguns pixels atrás.
        el.scrollTop = el.scrollHeight;
      } else {
        measure();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure]);

  return { scrollRef, contentRef, isAtBottom, onScroll: measure, scrollToBottom };
};

export default useStickToBottom;
