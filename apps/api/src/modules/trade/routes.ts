import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '@kuleplus/shared';
import {
  createSalesQuoteSchema,
  updateSalesQuoteSchema,
  SalesQuoteListQuerySchema,
} from './sales-quote.service';
import {
  createSalesOrderSchema,
  updateSalesOrderSchema,
  SalesOrderListQuerySchema,
} from './sales-order.service';
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  PurchaseOrderListQuerySchema,
} from './purchase-order.service';
import {
  createDeliverySchema,
  updateDeliverySchema,
  DeliveryListQuerySchema,
} from './delivery.service';
import type { SalesQuoteListQuery } from './sales-quote.service';
import type { SalesOrderListQuery } from './sales-order.service';
import type { PurchaseOrderListQuery } from './purchase-order.service';
import type { DeliveryListQuery } from './delivery.service';
import {
  createSalesQuote,
  getSalesQuoteById,
  listSalesQuotes,
  updateSalesQuote as updateSalesQuoteService,
  updateSalesQuoteStatus as updateSalesQuoteStatusService,
  deleteSalesQuote,
} from './sales-quote.service';
import {
  createSalesOrder,
  getSalesOrderById,
  listSalesOrders,
  updateSalesOrder as updateSalesOrderService,
  updateSalesOrderStatus as updateSalesOrderStatusService,
  deleteSalesOrder,
} from './sales-order.service';
import {
  createPurchaseOrder,
  getPurchaseOrderById,
  listPurchaseOrders,
  updatePurchaseOrder as updatePurchaseOrderService,
  updatePurchaseOrderStatus as updatePurchaseOrderStatusService,
  deletePurchaseOrder,
} from './purchase-order.service';
import {
  createDelivery,
  getDeliveryById,
  listDeliveries,
  updateDelivery as updateDeliveryService,
  updateDeliveryStatus as updateDeliveryStatusService,
  deleteDelivery,
} from './delivery.service';

const router = Router();

// Tüm ticari uçlar: kimlik + tenant + entitlement
router.use(authenticate, tenantContext, requireEntitlement('trade'));

// ============ Sales Quotes ============

router.get(
  '/quotes',
  validate(SalesQuoteListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listSalesQuotes(req.query as unknown as SalesQuoteListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/quotes/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await getSalesQuoteById(req.params.id);
    if (!result) throw new AppError('NOT_FOUND', 'Sales quote not found');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/quotes',
  validate(createSalesQuoteSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createSalesQuote(req.user!.sub, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/quotes/:id',
  validate(updateSalesQuoteSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateSalesQuoteService(req.params.id, req.user!.sub, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/quotes/:id/status',
  validate(
    z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted']) }),
  ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateSalesQuoteStatusService(
        req.params.id,
        req.user!.sub,
        req.body.status,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/quotes/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deleteSalesQuote(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Sales Orders ============

router.get(
  '/orders',
  validate(SalesOrderListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listSalesOrders(req.query as unknown as SalesOrderListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/orders/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await getSalesOrderById(req.params.id);
    if (!result) throw new AppError('NOT_FOUND', 'Sales order not found');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/orders',
  validate(createSalesOrderSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createSalesOrder(req.user!.sub, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/orders/:id',
  validate(updateSalesOrderSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateSalesOrderService(req.params.id, req.user!.sub, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/orders/:id/status',
  validate(
    z.object({
      status: z.enum([
        'draft',
        'confirmed',
        'partial_delivered',
        'delivered',
        'invoiced',
        'cancelled',
      ]),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateSalesOrderStatusService(
        req.params.id,
        req.user!.sub,
        req.body.status,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/orders/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deleteSalesOrder(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Purchase Orders ============

router.get(
  '/purchase-orders',
  validate(PurchaseOrderListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listPurchaseOrders(req.query as unknown as PurchaseOrderListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/purchase-orders/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await getPurchaseOrderById(req.params.id);
      if (!result) throw new AppError('NOT_FOUND', 'Purchase order not found');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/purchase-orders',
  validate(createPurchaseOrderSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createPurchaseOrder(req.user!.sub, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/purchase-orders/:id',
  validate(updatePurchaseOrderSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updatePurchaseOrderService(req.params.id, req.user!.sub, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/purchase-orders/:id/status',
  validate(
    z.object({
      status: z.enum([
        'draft',
        'sent',
        'confirmed',
        'partial_received',
        'received',
        'invoiced',
        'cancelled',
      ]),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updatePurchaseOrderStatusService(
        req.params.id,
        req.user!.sub,
        req.body.status,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/purchase-orders/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deletePurchaseOrder(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Deliveries ============

router.get(
  '/deliveries',
  validate(DeliveryListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listDeliveries(req.query as unknown as DeliveryListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/deliveries/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await getDeliveryById(req.params.id);
      if (!result) throw new AppError('NOT_FOUND', 'Delivery not found');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/deliveries',
  validate(createDeliverySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createDelivery(req.user!.sub, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/deliveries/:id',
  validate(updateDeliverySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateDeliveryService(req.params.id, req.user!.sub, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/deliveries/:id/status',
  validate(
    z.object({
      status: z.enum(['draft', 'prepared', 'shipped', 'delivered', 'returned', 'cancelled']),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateDeliveryStatusService(
        req.params.id,
        req.user!.sub,
        req.body.status,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/deliveries/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deleteDelivery(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as tradeRoutes };
