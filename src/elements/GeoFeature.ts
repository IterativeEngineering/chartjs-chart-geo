import {
  Element,
  BarElement,
  BarOptions,
  VisualElement,
  Point,
  ChartType,
  ScriptableAndArrayOptions,
  CommonHoverOptions,
  ScriptableContext,
} from 'chart.js';
import { geoContains, GeoPath, GeoProjection } from 'd3-geo';
import type { ProjectionScale } from '../scales';

export interface IGeoFeatureOptions extends Omit<BarOptions, 'borderWidth'>, Record<string, unknown> {
  /**
   * Width of the border
   * @default 0
   */
  borderWidth: number;

  /**
   * background color for the outline
   * @default null
   */
  outlineBackgroundColor: string | null;
  /**
   * border color for the outline
   * @default defaultColor of Chart.js
   */
  outlineBorderColor: string;
  /**
   * border width for the outline
   * @default 0
   */
  outlineBorderWidth: number;

  /**
   * border color for the graticule
   * @default #CCCCCC
   */
  graticuleBorderColor: string;
  /**
   * border width for the graticule
   * @default 0
   */
  graticuleBorderWidth: number;
}

export type Feature = any;

type GeoBounds = ReturnType<GeoPath['bounds']>;

function growGeoBounds(bounds: GeoBounds, amount: number): GeoBounds {
  return [
    [bounds[0][0] - amount, bounds[0][1] - amount],
    [bounds[1][0] + amount, bounds[1][1] + amount],
  ];
}

export interface IGeoFeatureProps {
  x: number;
  y: number;
}

export class GeoFeature extends Element<IGeoFeatureProps, IGeoFeatureOptions> implements VisualElement {
  // Our data source for the map contains a number of islands,
  // which are technically parts of other countries.
  // These islands should not have a circle around them.
  // This list may get expanded in the future.
  featuresWhichShouldNotBeCircledOnTheMap = [
    'Ashmore and Cartier Is.',
  ];

  COUNTRY_COLOR_NO_DATA = '#EFF1F2';
  SMALL_COUNTRY_CIRCLE_RADIUS = 5;

  /**
   * @hidden
   */
  cache?:
    | {
        center?: Point;
        bounds?: {
          x: number;
          y: number;
          width: number;
          height: number;
          x2: number;
          y2: number;
        };
        canvasKey?: string;
        canvas?: HTMLCanvasElement;
      }
    | undefined = undefined;

  /**
   * @hidden
   */
  projectionScale!: ProjectionScale;

  /**
   * @hidden
   */
  feature!: Feature;

  /**
   * @hidden
   */
  center?: { longitude: number; latitude: number };

  /**
   * @hidden
   */
  pixelRatio?: number;

  /**
   * @hidden
   */
  inRange(mouseX: number, mouseY: number): boolean {
    if (this.feature && this.shouldBeCircledOnTheMap(this.feature.properties?.alpha2, this.feature.properties?.name)) {
      if (window['chartGeoSmallCountriesCircleCenters'].find(center => {
        const distanceToCircleCenter = Math.sqrt((center[0] - mouseX) ** 2 + (center[1] - mouseY) ** 2);
        return distanceToCircleCenter < this.SMALL_COUNTRY_CIRCLE_RADIUS;
      })) {
        return true;
      }
    }
    const bb = this.getBounds();
    const r =
      (Number.isNaN(mouseX) || (mouseX >= bb.x && mouseX <= bb.x2)) &&
      (Number.isNaN(mouseY) || (mouseY >= bb.y && mouseY <= bb.y2));

    const projection = this.projectionScale.geoPath.projection() as unknown as GeoProjection;
    if (r && !Number.isNaN(mouseX) && !Number.isNaN(mouseY) && typeof projection.invert === 'function') {
      // test for real if within the bounds
      const longLat = projection.invert([mouseX, mouseY]);
      return longLat != null && geoContains(this.feature, longLat);
    }

    return r;
  }

  /**
   * @hidden
   */
  inXRange(mouseX: number): boolean {
    return this.inRange(mouseX, Number.NaN);
  }

  /**
   * @hidden
   */
  inYRange(mouseY: number): boolean {
    return this.inRange(Number.NaN, mouseY);
  }

  /**
   * @hidden
   */
  getCenterPoint(): { x: number; y: number } {
    if (this.cache && this.cache.center) {
      return this.cache.center;
    }
    let center: { x: number; y: number };
    if (this.center) {
      const p = this.projectionScale.projection([this.center.longitude, this.center.latitude])!;
      center = {
        x: p[0]!,
        y: p[1]!,
      };
    } else {
      const centroid = this.projectionScale.geoPath.centroid(this.feature);
      center = {
        x: centroid[0],
        y: centroid[1],
      };
    }
    this.cache = { ...(this.cache || {}), center };
    return center;
  }

  /**
   * @hidden
   */
  getBounds(): { x: number; y: number; x2: number; y2: number; width: number; height: number } {
    if (this.cache && this.cache.bounds) {
      return this.cache.bounds;
    }
    const bb = growGeoBounds(this.projectionScale.geoPath.bounds(this.feature), this.options.borderWidth / 2);
    const bounds = {
      x: bb[0][0],
      x2: bb[1][0],
      y: bb[0][1],
      y2: bb[1][1],
      width: bb[1][0] - bb[0][0],
      height: bb[1][1] - bb[0][1],
    };
    this.cache = { ...(this.cache || {}), bounds };
    return bounds;
  }

  /**
   * @hidden
   */
  _drawInCache(doc: Document): void {
    const bounds = this.getBounds();
    if (!Number.isFinite(bounds.x)) {
      return;
    }
    const canvas = this.cache && this.cache.canvas ? this.cache.canvas : doc.createElement('canvas');
    const x1 = Math.floor(bounds.x);
    const y1 = Math.floor(bounds.y);
    const x2 = Math.ceil(bounds.x + bounds.width);
    const y2 = Math.ceil(bounds.y + bounds.height);
    const pixelRatio = this.pixelRatio || 1;
    const width = Math.ceil(Math.max(x2 - x1, 1) * pixelRatio);
    const height = Math.ceil(Math.max(y2 - y1, 1) * pixelRatio);
    if (width <= 0 || height <= 0) {
      return;
    }
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.translate(-x1, -y1);
      this._drawImpl(ctx);
      ctx.restore();

      this.cache = { ...(this.cache || {}), canvas, canvasKey: this._optionsToKey() };
    }
  }

  /**
   * @hidden
   */
  _optionsToKey(): string {
    const { options } = this;
    return `${options.backgroundColor};${options.borderColor};${options.borderWidth};${this.pixelRatio}`;
  }

  /**
   * @hidden
   */
  _drawImpl(ctx: CanvasRenderingContext2D): void {
    const { feature } = this;
    const { options } = this;
    ctx.beginPath();
    this.projectionScale.geoPath.context(ctx)(feature);
    if (options.backgroundColor) {
      ctx.fillStyle = options.backgroundColor;
      ctx.fill();
    }
    if (options.borderColor) {
      ctx.strokeStyle = options.borderColor;
      ctx.lineWidth = options.borderWidth as number;
      ctx.stroke();
    }
  }

  /**
   * @hidden
   */
  draw(ctx: CanvasRenderingContext2D): void {
    const { feature } = this;
    if (!feature) {
      return;
    }
    if ((!this.cache || this.cache.canvasKey !== this._optionsToKey()) && ctx.canvas.ownerDocument != null) {
      this._drawInCache(ctx.canvas.ownerDocument);
    }
    const bounds = this.getBounds();
    if (this.cache && this.cache.canvas && this.cache.canvas.width > 0 && this.cache.canvas.height > 0) {
      const x1 = Math.floor(bounds.x);
      const y1 = Math.floor(bounds.y);
      const x2 = Math.ceil(bounds.x + bounds.width);
      const y2 = Math.ceil(bounds.y + bounds.height);
      const width = x2 - x1;
      const height = y2 - y1;
      if (this.options.backgroundColor !== this.COUNTRY_COLOR_NO_DATA && this.isSmallCountry(feature.properties?.alpha2, width, height, x1 + width / 2, y1 + height / 2) && !this.featuresWhichShouldNotBeCircledOnTheMap.includes(feature.properties?.name)) {
        // Draw circle for small countries which have data
        ctx.fillStyle = this.options.backgroundColor;
        // Use dark outline for light circle fill
        // or light outline for dark circle fill
        let circleOutlineColor = '#000000';
        if (this.options.backgroundColor === '#042335' || this.options.backgroundColor === '#526773') {
          circleOutlineColor = '#ffffff';
        }

        ctx.beginPath();
        ctx.arc(x1 + width / 2, y1 + height / 2, this.SMALL_COUNTRY_CIRCLE_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = this.options.backgroundColor;
        ctx.fill();
        ctx.strokeStyle = circleOutlineColor;
        ctx.stroke();
      }
      if (width > 0 && height > 0) {
        ctx.drawImage(this.cache.canvas, x1, y1, x2 - x1, y2 - y1);
      }
    } else if (Number.isFinite(bounds.x)) {
      ctx.save();
      this._drawImpl(ctx);
      ctx.restore();
    }
  }

  isSmallCountry(alpha2: string, width: number, height: number, circleCenterX: number, circleCenterY: number) {
    const isSmallCountry = !!alpha2 && (width < 5 || height < 5);
    
    if (isSmallCountry && !window['chartGeoSmallCountries'].includes(alpha2)) {
      window['chartGeoSmallCountries'].push(alpha2);
      window['chartGeoSmallCountriesCircleCenters'].push([circleCenterX, circleCenterY]);
    }
    return isSmallCountry;
  }

  shouldBeCircledOnTheMap(alpha2: string, featureName: string) {
    return window['chartGeoSmallCountries'].includes(alpha2) && !this.featuresWhichShouldNotBeCircledOnTheMap.includes(featureName);
  }

  static id = 'geoFeature';

  /**
   * @hidden
   */
  static defaults = /* #__PURE__ */ {
    ...BarElement.defaults,
    outlineBackgroundColor: null,
    outlineBorderWidth: 0,

    graticuleBorderColor: '#CCCCCC',
    graticuleBorderWidth: 0,
  };

  /**
   * @hidden
   */
  static defaultRoutes = /* #__PURE__ */ {
    outlineBorderColor: 'borderColor',
    ...(BarElement.defaultRoutes || {}),
  };
}

declare module 'chart.js' {
  export interface ElementOptionsByType<TType extends ChartType> {
    geoFeature: ScriptableAndArrayOptions<IGeoFeatureOptions & CommonHoverOptions, ScriptableContext<TType>>;
  }
}
