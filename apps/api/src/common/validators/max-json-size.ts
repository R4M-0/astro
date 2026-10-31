import { registerDecorator, ValidationOptions } from 'class-validator';

/** Caps the serialised size of a free-form JSON payload (public forms especially). */
export function MaxJsonSize(maxBytes: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'maxJsonSize',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} is too large (max ${maxBytes} bytes)`, ...options },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          try {
            return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
          } catch {
            return false;
          }
        },
      },
    });
}
