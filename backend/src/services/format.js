function interpretationFields(output) {
  const fields = [];
  if (!output || typeof output !== 'object') return fields;
  if (output.job_reference) fields.push({ label: 'Job', value: output.job_reference });
  for (const [key, value] of Object.entries(output.extracted_data ?? {})) {
    if (value == null || value === '') continue;
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    fields.push({ label, value: typeof value === 'object' ? JSON.stringify(value) : String(value) });
  }
  if (Array.isArray(output.events) && output.events.length > 0) {
    fields.push({ label: 'Also detected', value: output.events.join(', ') });
  }
  return fields;
}

module.exports = { interpretationFields };
