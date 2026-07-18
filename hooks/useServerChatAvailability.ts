import { useEffect, useState } from 'react';
import * as ServerChat from '../services/serverChatService';

export const useServerChatAvailability = () => {
  const [serverChatAvailable, setServerChatAvailable] = useState<boolean>(false);

  useEffect(() => {
    ServerChat.isServerChatAvailable().then(available => {
      setServerChatAvailable(available);
    });
  }, []);

  return { serverChatAvailable, setServerChatAvailable };
};
