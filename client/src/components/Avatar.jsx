import { useState } from 'react';

function initialsOf(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '👤';
}

export default function Avatar({ name, photo, size = 40, className = '' }) {
  const [failed, setFailed] = useState(false);

  const base = `flex items-center justify-center rounded-full overflow-hidden shrink-0 ${className}`;

  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt="profile"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${base} object-cover`}
      />
    );
  }

  return (
    <div
      className={`${base} bg-gradient-to-br from-brand to-lemon text-sm font-bold text-white`}
      title={name || 'Customer'}
    >
      {initialsOf(name)}
    </div>
  );
}