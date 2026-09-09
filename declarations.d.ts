declare module '@monaco-editor/react' {
  import * as React from 'react';

  export interface EditorProps {
    height?: string | number;
    width?: string | number;
    defaultLanguage?: string;
    defaultValue?: string;
    value?: string;
    theme?: string;
    options?: any;
    onChange?: (value: string | undefined, event: any) => void;
    beforeMount?: (monaco: any) => void;
    onMount?: (editor: any, monaco: any) => void;
    loading?: React.ReactNode;
    className?: string;
    wrapperProps?: object;
  }

  const Editor: React.FC<EditorProps>;
  export default Editor;
  
  export const useMonaco: () => any;
  export const loader: {
    init: () => Promise<any>;
    config: (params: any) => void;
    __getMonacoInstance: () => any;
  };
}