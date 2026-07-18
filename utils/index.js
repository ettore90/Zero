export function sanitizeSSHOutput(text=''){ return String(text).replace(/^Warning: Permanently added .* to the list of known hosts\.\r?\n?/gm,'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim(); }
export function containerToHost(p){ return p; }
export function hostToContainer(p){ return p; }
