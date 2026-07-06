import type { MerlinThreadMessage } from './types';

export default function MessageTimeline(props: { messages: MerlinThreadMessage[] }) {
  if (props.messages.length === 0) {
    return (
      <div className="message-timeline empty">
        <p>No messages yet. Describe what you want updated and attach any proof below.</p>
      </div>
    );
  }

  return (
    <div className="message-timeline" aria-live="polite">
      {props.messages.map((message) => (
        <div key={message.id} className={`message-bubble role-${message.role}`}>
          <span className="message-role">{message.role}</span>
          {message.message_text && <p>{message.message_text}</p>}
          {message.attachments.length > 0 && (
            <ul className="message-attachments">
              {message.attachments.map((attachment) => (
                <li key={attachment.fileId}>{attachment.fileName}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
