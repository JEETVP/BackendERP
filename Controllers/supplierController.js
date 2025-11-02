// Controllers/supplierController.js
const Supplier = require('../Models/Supplier');
const PurchaseOrder = require('../Models/PurchaseOrder');

// GET /api/suppliers
// Lista todos los proveedores (puedes filtrar por ?q=texto)
exports.listSuppliers = async (req, res, next) => {
  try {
    const { q } = req.query;
    const filter = q
      ? {
          $or: [
            { name: new RegExp(q, 'i') },
            { rfc: new RegExp(q, 'i') },
            { emails: { $elemMatch: { $regex: q, $options: 'i' } } },
          ],
        }
      : {};
    const list = await Supplier.find(filter).sort({ name: 1 });
    res.json({ ok: true, data: list });
  } catch (err) {
    next(err);
  }
};

// POST /api/suppliers
// Crea un proveedor
exports.createSupplier = async (req, res, next) => {
  try {
    const {
      name,
      rfc,
      emails,
      phones,
      contacts,
      address,
      paymentTerms,
      bankAccounts,
      leadTimeDays,
      defaultCurrency,
      preferredIncoterm,
      notes,
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, message: 'name es requerido' });
    }

    // Validación sencilla de duplicados por nombre o RFC
    if (rfc) {
      const rfcExists = await Supplier.findOne({ rfc: String(rfc).toUpperCase().trim() });
      if (rfcExists) {
        return res.status(409).json({ ok: false, message: 'RFC ya registrado en otro proveedor' });
      }
    }
    const nameExists = await Supplier.findOne({ name: name.trim() });
    if (nameExists) {
      // opcional: permitir nombres repetidos; aquí devolvemos conflicto
      // quita este bloque si quieres permitir duplicados por nombre
      return res.status(409).json({ ok: false, message: 'Nombre de proveedor ya registrado' });
    }

    const doc = await Supplier.create({
      name,
      rfc,
      emails,
      phones,
      contacts,
      address,
      paymentTerms,
      bankAccounts,
      leadTimeDays,
      defaultCurrency,
      preferredIncoterm,
      notes,
      createdBy: req.user?.id,
    });

    res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/suppliers/:id
// Elimina un proveedor (bloquea si hay dependencias)
exports.deleteSupplier = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Integridad: no permitir borrar si hay órdenes de compra vinculadas
    const poCount = await PurchaseOrder.countDocuments({ supplier: id });
    if (poCount > 0) {
      return res.status(409).json({
        ok: false,
        message: `No se puede eliminar: existen ${poCount} órdenes de compra asociadas`,
      });
    }

    const deleted = await Supplier.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, message: 'Proveedor no encontrado' });

    res.json({ ok: true, message: 'Proveedor eliminado' });
  } catch (err) {
    next(err);
  }
};
