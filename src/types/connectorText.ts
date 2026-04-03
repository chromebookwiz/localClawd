export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text: string
}

export type ConnectorTextDelta = {
  type: 'connector_text_delta'
  connector_text: string
}

export function isConnectorTextBlock(
  value: unknown,
): value is ConnectorTextBlock {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ConnectorTextBlock>
  return (
    candidate.type === 'connector_text' &&
    typeof candidate.connector_text === 'string'
  )
}