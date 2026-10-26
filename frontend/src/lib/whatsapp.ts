// WhatsApp click-to-chat links (wa.me). There's no official WhatsApp API yet,
// so the person presses send in WhatsApp themselves.

/**
 * A wa.me link that opens WhatsApp with `text` ready to send. With a phone
 * number it opens that chat (10 digits = Indian, like the backend); without
 * one, WhatsApp asks who to send it to.
 */
export function whatsappLink(text: string, phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
