const { db: firebase } = require('./firebase');

/**
 * Creates or reuses a system/transactional chat thread between a customer and a vendor,
 * tied to a specific context (order, reservation, ticket, etc.)
 * Posts an automated system message into the thread.
 */
async function createSystemChat({ customerId, vendorUserId, contextType, contextId, contextLabel, systemMessage }) {
  try {
    const chatId = `system_${[customerId, vendorUserId].sort().join('_')}`;

    const message = {
      text: systemMessage,
      type: 'system',
      context_type: contextType,
      context_id: contextId,
      context_label: contextLabel,
      sender_id: vendorUserId,
      timestamp: Date.now(),
      is_saved: false,
      is_read: false,
    };

    await firebase.ref(`chats/${chatId}/messages`).push(message);

    await firebase.ref(`chats/${chatId}/metadata`).update({
      last_message: systemMessage,
      last_sender: vendorUserId,
      updated_at: Date.now(),
      is_system_chat: true,
      participants: { [customerId]: true, [vendorUserId]: true },
    });

    await firebase.ref(`users/${customerId}/chats`).update({ [chatId]: Date.now() });
    await firebase.ref(`users/${vendorUserId}/chats`).update({ [chatId]: Date.now() });

    return chatId;
  } catch (err) {
    console.error('createSystemChat error:', err.message);
    return null;
  }
}

module.exports = { createSystemChat };
