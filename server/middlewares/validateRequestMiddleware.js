import * as z from "zod";

export default function validateRequest(schema, options = {}) {
  const { source = "body", select = (req) => req[source] } = options;

  return (req, res, next) => {
    const result = schema.safeParse(select(req));

    if (!result.success) {
      const { fieldErrors, formErrors } = z.flattenError(result.error);
      return res.status(400).json({
        error: {
          ...fieldErrors,
          ...(formErrors.length > 0 ? { _errors: formErrors } : {}),
        },
      });
    }

    req.validated = {
      ...req.validated,
      [source]: result.data,
    };
    return next();
  };
}
